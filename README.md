# Hale London

A map of wellness places in London: clinics, gyms and boutique studios, healthy food, saunas and spas, therapy and meditation. Search, filter by area and need, ask the concierge, save places, and make your own guides with notes to share.

**Open it:** https://jackroyd7.github.io/hale-london/

On iPhone, open the link in Safari and choose **Share → Add to Home Screen** to use it like an app.

## Your own guides

In **Guides**, choose **Create a guide**. Give it a title and description, add places in order (search, or use **Add to a guide** on any place's page), and write a note for each stop. The map numbers the stops and can draw the route with walking times. **Copy share link** gives a link that opens the guide for anyone, who can then save their own copy.

Guides, saved places and settings are stored in your browser only, so they don't sync between devices. Share a guide's link to move it to another device.

## Rebuilding the site

Everything needed to rebuild `index.html` is in `build/`. You need Python 3; nothing else to install.

1. Download fresh venue data from OpenStreetMap. This takes a few minutes and resumes if the servers are busy:

   ```bash
   python3 build/fetch_london_venues.py
   ```

2. Process it and rebuild the page:

   ```bash
   python3 build/build.py --refresh
   ```

   Without `--refresh`, `build.py` just rebuilds `index.html` from the last processed data (`build/data/venues.json`). Use that after editing the app code.

3. Commit and push. GitHub Pages republishes the site a minute or two later.

### What's in `build/`

| File | What it does |
|---|---|
| `fetch_london_venues.py` | Downloads venues and stations from OpenStreetMap into `data/london_osm.json` |
| `process_osm.py` | Classifies venues, filters out non-wellness places, parses opening hours, finds boroughs and nearest stations, and merges `chains.json` |
| `chains.json` | Official club lists for Third Space, Psycle, Barry's and 1Rebel, taken from each brand's website. These correct and complete the OpenStreetMap entries |
| `build.py` | Puts the template, styles, app code and data together into `index.html` |
| `template.html`, `app.js`, `data.js` | The page layout and styles, the app, and category definitions |
| `boroughs.min.json`, `simplify.py` | Simplified London borough boundaries and the script that simplified them |
| `data/` | Downloaded OpenStreetMap data and the processed `venues.json` |

To add another chain, add its clubs to `chains.json` (brand, type, branch name, address with postcode, coordinates and club page link) and run `python3 build/build.py --refresh`.

## Credits and data

- Venue data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database Licence (ODbL).
- Club and studio lists for Third Space, Psycle, Barry's and 1Rebel from each brand's own website; locations from [postcodes.io](https://postcodes.io) (ONS open data).
- Street maps from [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://www.openmaptiles.org/).
- Borough boundaries simplified from London Datastore open data.
- Map libraries in `vendor/`: [Leaflet](https://leafletjs.com), [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster), [MapLibre GL JS](https://maplibre.org) and [MapLibre GL Leaflet](https://github.com/maplibre/maplibre-gl-leaflet), each under its own licence.

Details can be out of date, so check with each venue before you go. This is a prototype and is not affiliated with any of the venues listed.
