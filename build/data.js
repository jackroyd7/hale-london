// Category and need definitions for Hale London. Venue and station data come from OpenStreetMap (see venues.json).
const CATEGORIES = {
  clinic:{label:"Clinics",one:"Clinic",glyph:"+"},
  move:{label:"Gyms & studios",one:"Movement",glyph:"▲"},
  eat:{label:"Cafés & food",one:"Eat & drink",glyph:"●"},
  recover:{label:"Spa & recovery",one:"Recovery",glyph:"≈"},
  mind:{label:"Mind & therapy",one:"Mind",glyph:"◆"}
};

const NEEDS = {
  "back-pain":"Back & neck pain","injury":"Injury & rehab","running":"Running","stress":"Stress & anxiety",
  "sleep":"Sleep","energy":"Energy & fatigue","gut-health":"Gut health","womens-health":"Women's health",
  "menopause":"Menopause","pregnancy":"Pregnancy & postnatal","strength":"Strength","flexibility":"Mobility",
  "recovery":"Recovery","social":"Meet people","sober":"Alcohol-free","healthy-eating":"Healthy eating","focus":"Focus"
};

// Rough path of the Thames through Greater London (west to east), [lat,lng].
const THAMES = [[51.402,-0.343],[51.411,-0.308],[51.428,-0.322],[51.447,-0.316],[51.459,-0.307],[51.471,-0.298],[51.478,-0.287],[51.486,-0.272],[51.484,-0.255],[51.474,-0.247],[51.472,-0.236],[51.485,-0.228],[51.479,-0.218],[51.467,-0.213],[51.465,-0.198],[51.471,-0.183],[51.482,-0.172],[51.484,-0.157],[51.485,-0.134],[51.489,-0.124],[51.501,-0.122],[51.507,-0.118],[51.509,-0.104],[51.507,-0.090],[51.505,-0.076],[51.502,-0.060],[51.505,-0.047],[51.509,-0.035],[51.499,-0.029],[51.487,-0.022],[51.484,-0.010],[51.490,0.001],[51.501,0.002],[51.508,0.004],[51.507,0.012],[51.499,0.017],[51.498,0.035],[51.497,0.055],[51.493,0.075],[51.501,0.095],[51.506,0.115],[51.497,0.150],[51.483,0.180],[51.470,0.210]];

const REGIONS = {
  Central:["Camden","City of London","Islington","Kensington and Chelsea","Lambeth","Southwark","Westminster"],
  North:["Barnet","Enfield","Haringey"],
  East:["Barking and Dagenham","Bexley","Greenwich","Hackney","Havering","Lewisham","Newham","Redbridge","Tower Hamlets","Waltham Forest"],
  South:["Bromley","Croydon","Kingston upon Thames","Merton","Sutton","Wandsworth"],
  West:["Brent","Ealing","Hammersmith and Fulham","Harrow","Hillingdon","Hounslow","Richmond upon Thames"]
};
