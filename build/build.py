#!/usr/bin/env python3
"""Build Hale London's index.html from the source files in this folder.

Run from the repository root:
  python3 build/build.py             rebuild index.html from build/data/venues.json
  python3 build/build.py --refresh   first re-process build/data/london_osm.json
                                     (and chains.json) into build/data/venues.json

Extra outputs (optional):
  --artifact PATH   claude.ai Artifact version (libraries from cdnjs, borough map, no street tiles)
  --inline PATH     street-map version with every library inlined, for testing offline
"""
import argparse, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VENDOR = os.path.join(ROOT, "vendor")


def read(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()


ap = argparse.ArgumentParser()
ap.add_argument("--refresh", action="store_true")
ap.add_argument("--artifact")
ap.add_argument("--inline")
args = ap.parse_args()

if args.refresh:
    subprocess.run([sys.executable, "-I", os.path.join(HERE, "process_osm.py"),
                    os.path.join(HERE, "data", "london_osm.json"), os.path.join(HERE, "boroughs.min.json"),
                    os.path.join(HERE, "data", "venues.json")], check=True)

t = read(HERE, "template.html")
lcss = re.sub(r"url\([^)]*\)", "none", read(VENDOR, "leaflet.css"))
t = t.replace("/*__LEAFLET_CSS__*/", lcss).replace("/*__CLUSTER_CSS__*/", read(VENDOR, "MarkerCluster.css"))
t = t.replace("/*__BOROUGHS__*/", "const BOROUGHS=" + read(HERE, "boroughs.min.json") + ";")
t = t.replace("/*__DATA__*/", "const OSMDATA=" + read(HERE, "data", "venues.json") + ";\n" + read(HERE, "data.js"))
t = t.replace("/*__APP__*/", read(HERE, "app.js"))

HEAD = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="description" content="Find wellness places across London: clinics, gyms and studios, healthy food, saunas and spas, therapy and meditation.">'
        '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="Hale"><meta name="apple-mobile-web-app-status-bar-style" content="default">'
        '<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">'
        '<meta name="theme-color" content="#152019" media="(prefers-color-scheme: dark)">'
        '<link rel="apple-touch-icon" href="apple-touch-icon.png"><link rel="icon" href="apple-touch-icon.png">'
        '<style>[hidden]{display:none!important}body{margin:0;font-size:14px}img{max-width:100%}</style></head><body class="tiles">')
GL_CSS = "<style>" + read(VENDOR, "maplibre-gl.css") + "</style>"
FLAGS = "<script>window.HALE_TILES=true;window.HALE_SHARE=true;</script>"

# GitHub Pages: libraries served from vendor/.
vend = "\n".join(f'<script src="vendor/{f}"></script>' for f in
                 ["leaflet.js", "leaflet.markercluster.js", "maplibre-gl.js", "leaflet-maplibre-gl.js"]) + "\n" + FLAGS
with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
    f.write(HEAD + GL_CSS + t.replace("<!--__LIBS__-->", vend) + "</body></html>")
print("Wrote index.html")

if args.artifact:
    cdn = ('<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>\n'
           '<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js"></script>')
    with open(args.artifact, "w", encoding="utf-8") as f:
        f.write(t.replace("<!--__LIBS__-->", cdn))
    print("Wrote", args.artifact)

if args.inline:
    inl = "".join("<script>" + read(VENDOR, n) + "</script>" for n in
                  ["leaflet.js", "leaflet.markercluster.js", "maplibre-gl.js", "leaflet-maplibre-gl.js"]) + FLAGS
    with open(args.inline, "w", encoding="utf-8") as f:
        f.write(HEAD + GL_CSS + t.replace("<!--__LIBS__-->", inl) + "</body></html>")
    print("Wrote", args.inline)
