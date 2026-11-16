import json,sys,math
src,dst,tol=sys.argv[1],sys.argv[2],float(sys.argv[3])
def dp(pts,tol):
    if len(pts)<3: return pts
    a,b=pts[0],pts[-1]; dmax=0; idx=0
    ax,ay=a;bx,by=b; dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy
    for i in range(1,len(pts)-1):
        px,py=pts[i]
        if L==0: d=math.hypot(px-ax,py-ay)
        else:
            t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L)); d=math.hypot(px-ax-t*dx,py-ay-t*dy)
        if d>dmax: dmax=d; idx=i
    if dmax>tol:
        return dp(pts[:idx+1],tol)[:-1]+dp(pts[idx:],tol)
    return [a,b]
def ring(r):
    s=dp([(p[0],p[1]) for p in r],tol)
    if len(s)<4: s=[(p[0],p[1]) for p in r[::max(1,len(r)//4)]]+[tuple(r[0][:2])]
    return [[round(x,4),round(y,4)] for x,y in s]
d=json.load(open(src)); out=[]
for f in d['features']:
    g=f['geometry']
    polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
    polys=[[ring(r) for r in p] for p in polys]
    out.append({'type':'Feature','properties':{'name':f['properties']['name']},'geometry':{'type':'MultiPolygon','coordinates':polys}})
json.dump({'type':'FeatureCollection','features':out},open(dst,'w'),separators=(',',':'))
