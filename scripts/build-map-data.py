#!/usr/bin/env python3
"""Genera public/data/map-data.json para el mapa global de anomalías.

Convierte la malla oficial de NASA GISTEMP v4 (gistemp1200_GHCNv4_ERSSTv5.nc, NetCDF clásico,
anomalías mensuales en °C respecto a 1951-1980, celdas de 2°x2°) en un archivo ligero:

  - promedios ANUALES de 1926 hasta hoy,
  - agregados a celdas de 4°x4° (45 filas x 90 columnas),
  - cuantizados a 0,1 °C en enteros de 8 bits (-128 = sin dato) y codificados en base64,
  - más el contorno de los continentes (Natural Earth 110m, dominio público).

Solo usa la biblioteca estándar de Python (sin numpy ni netCDF4).

Uso:
  python -I scripts/build-map-data.py                   # descarga los datos y genera el JSON
  python -I scripts/build-map-data.py --nc x.nc.gz --land land.geojson --out public/data/map-data.json
"""
import argparse
import base64
import datetime
import gzip
import json
import math
import os
import struct
import sys
import tempfile
import urllib.request
from array import array

NASA_URL = "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz"
LAND_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson"

FIRST_YEAR = 1926
OUT_CELL_DEG = 4
SCALE = 0.1  # °C por unidad entera
MISSING = -128

NC_TYPES = {1: ("b", 1), 2: ("c", 1), 3: ("h", 2), 4: ("i", 4), 5: ("f", 4), 6: ("d", 8)}


# ---------- Lector mínimo de NetCDF clásico (CDF-1 / CDF-2) ----------
class Reader:
    def __init__(self, data):
        self.b = data
        self.p = 0

    def u32(self):
        v = struct.unpack_from(">I", self.b, self.p)[0]
        self.p += 4
        return v

    def u64(self):
        v = struct.unpack_from(">Q", self.b, self.p)[0]
        self.p += 8
        return v

    def name(self):
        n = self.u32()
        s = self.b[self.p : self.p + n].decode("utf-8", "replace")
        self.p += (n + 3) & ~3
        return s


def read_attrs(r):
    tag, n = r.u32(), r.u32()
    attrs = {}
    for _ in range(n):
        name = r.name()
        nctype, count = r.u32(), r.u32()
        code, size = NC_TYPES[nctype]
        raw = r.b[r.p : r.p + count * size]
        r.p += (count * size + 3) & ~3
        if nctype == 2:
            attrs[name] = raw.decode("utf-8", "replace")
        else:
            vals = struct.unpack(">%d%s" % (count, code), raw)
            attrs[name] = vals[0] if count == 1 else vals
    return attrs


def parse_netcdf(data):
    if data[:3] != b"CDF" or data[3] not in (1, 2):
        raise ValueError("No es un NetCDF clásico (CDF-1/CDF-2).")
    version = data[3]
    r = Reader(data)
    r.p = 4
    numrecs = r.u32()
    # dimensiones
    tag, n = r.u32(), r.u32()
    dims = []
    for _ in range(n):
        dims.append((r.name(), r.u32()))
    read_attrs(r)  # atributos globales
    tag, n = r.u32(), r.u32()
    variables = {}
    for _ in range(n):
        name = r.name()
        ndims = r.u32()
        dimids = [r.u32() for _ in range(ndims)]
        attrs = read_attrs(r)
        nctype = r.u32()
        vsize = r.u32()
        begin = r.u32() if version == 1 else r.u64()
        variables[name] = {"dims": dimids, "attrs": attrs, "type": nctype, "vsize": vsize, "begin": begin}
    rec_vars = [v for v in variables.values() if v["dims"] and dims[v["dims"][0]][1] == 0]
    recsize = sum(v["vsize"] for v in rec_vars)
    if rec_vars and numrecs == 0xFFFFFFFF:
        numrecs = (len(data) - min(v["begin"] for v in rec_vars)) // recsize
    return dims, variables, recsize, numrecs


def record_offset(dims, var, t, recsize):
    """Posición del registro `t` de una variable (primera dimensión = tiempo).

    Si `time` es la dimensión ilimitada los registros van intercalados (recsize);
    si es una dimensión fija (caso de GISTEMP) cada variable es contigua.
    """
    code, size = NC_TYPES[var["type"]]
    if dims[var["dims"][0]][1] == 0:
        return var["begin"] + t * recsize
    per_record = size
    for d in var["dims"][1:]:
        per_record *= dims[d][1]
    return var["begin"] + t * per_record


def read_fixed(data, var, count):
    code, size = NC_TYPES[var["type"]]
    return struct.unpack(">%d%s" % (count, code), data[var["begin"] : var["begin"] + count * size])


# ---------- Proceso ----------
def download(url, dest):
    print("Descargando", url)
    urllib.request.urlretrieve(url, dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nc", help="gistemp1200_GHCNv4_ERSSTv5.nc.gz ya descargado")
    ap.add_argument("--land", help="ne_110m_land.geojson ya descargado")
    ap.add_argument("--out", default=os.path.join("public", "data", "map-data.json"))
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="gistemp-")
    nc_path = args.nc or os.path.join(tmp, "gistemp.nc.gz")
    land_path = args.land or os.path.join(tmp, "land.geojson")
    if not args.nc:
        download(NASA_URL, nc_path)
    if not args.land:
        download(LAND_URL, land_path)

    with gzip.open(nc_path, "rb") as f:
        data = f.read()
    dims, variables, recsize, numrecs = parse_netcdf(data)
    dim_len = {name: length for name, length in dims}
    nlat, nlon = dim_len["lat"], dim_len["lon"]
    if numrecs == 0:
        numrecs = dim_len["time"]
    var = variables["tempanomaly"]
    tvar = variables["time"]
    print("Malla %dx%d, %d meses, tipo %d" % (nlat, nlon, numrecs, var["type"]))

    fill = var["attrs"].get("_FillValue", 9999.0)
    scale = var["attrs"].get("scale_factor", 1.0)
    offset = var["attrs"].get("add_offset", 0.0)
    code, size = NC_TYPES[var["type"]]
    tcode, tsize = NC_TYPES[tvar["type"]]
    cells = nlat * nlon

    # Fechas (días desde 1800-01-01)
    base = datetime.date(1800, 1, 1)
    months = []
    for t in range(numrecs):
        off = record_offset(dims, tvar, t, recsize)
        days = struct.unpack(">" + tcode, data[off : off + tsize])[0]
        d = base + datetime.timedelta(days=float(days))
        months.append((d.year, d.month))
    last_year = months[-1][0]
    months_in_year = {}
    for y, _m in months:
        months_in_year[y] = months_in_year.get(y, 0) + 1
    print("Datos hasta %d-%02d" % months[-1])

    years = list(range(FIRST_YEAR, last_year + 1))
    sums = {y: [0.0] * cells for y in years}
    counts = {y: [0] * cells for y in years}
    for t, (y, _m) in enumerate(months):
        if y < FIRST_YEAR:
            continue
        off = record_offset(dims, var, t, recsize)
        raw = array(code.lower() if code == "f" else code)
        raw.frombytes(data[off : off + cells * size])
        if sys.byteorder == "little":
            raw.byteswap()
        s, c = sums[y], counts[y]
        for i in range(cells):
            v = raw[i]
            if v != v or v == fill or abs(v) > 500:
                continue
            s[i] += v * scale + offset
            c[i] += 1

    # Latitudes/longitudes de la malla original (centros de celda)
    lats = read_fixed(data, variables["lat"], nlat)
    lons = read_fixed(data, variables["lon"], nlon)
    assert abs(lats[1] - lats[0]) == 2 and abs(lons[1] - lons[0]) == 2, "Se esperaba malla de 2°"
    south_first = lats[0] < lats[-1]

    ratio = OUT_CELL_DEG // 2
    rows, cols = nlat // ratio, nlon // ratio
    out = bytearray()
    global_check = {}
    for y in years:
        need = max(1, (months_in_year[y] + 1) // 2)
        annual = [None] * cells
        for i in range(cells):
            if counts[y][i] >= need:
                annual[i] = sums[y][i] / counts[y][i]
        wsum = wtot = 0.0
        for R in range(rows):
            for C in range(cols):
                vals = []
                for dr in range(ratio):
                    for dc in range(ratio):
                        r2 = R * ratio + dr
                        if not south_first:
                            r2 = nlat - 1 - r2
                        v = annual[r2 * nlon + C * ratio + dc]
                        if v is not None:
                            vals.append(v)
                if not vals:
                    out.append(MISSING & 0xFF)
                    continue
                mean = sum(vals) / len(vals)
                q = max(-127, min(127, round(mean / SCALE)))
                out += struct.pack("b", q)
                w = math.cos(math.radians(-90 + OUT_CELL_DEG * (R + 0.5)))
                wsum += w * mean
                wtot += w
        global_check[y] = wsum / wtot if wtot else float("nan")

    for y in (1998, 2016, 2024):
        if y in global_check:
            print("Control %d: media ponderada de la malla = %+.2f °C (compárese con la columna J-D del CSV global)" % (y, global_check[y]))

    # Continentes
    with open(land_path, encoding="utf-8") as f:
        geo = json.load(f)
    rings = []

    def add_ring(ring):
        flat, prev = [], None
        for lon, lat, *_ in ring:
            pt = (round(lon, 1), round(lat, 1))
            if pt != prev:
                flat += [pt[0], pt[1]]
                prev = pt
        if len(flat) >= 6:
            rings.append(flat)

    for feat in geo["features"]:
        g = feat["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        for poly in polys:
            for ring in poly:
                add_ring(ring)

    result = {
        "source": "NASA GISS GISTEMP v4 (gistemp1200_GHCNv4_ERSSTv5), anomalías anuales; contornos: Natural Earth 110m",
        "reference": "1951-1980",
        "years": years,
        "lastYearMonths": months_in_year[last_year],
        "rows": rows,
        "cols": cols,
        "cellDeg": OUT_CELL_DEG,
        "scale": SCALE,
        "missing": MISSING,
        "land": rings,
        "data": base64.b64encode(bytes(out)).decode("ascii"),
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, separators=(",", ":"))
    print("Escrito %s (%.0f KB, %d años, %d anillos de costa)" % (args.out, os.path.getsize(args.out) / 1024, len(years), len(rings)))


if __name__ == "__main__":
    main()
