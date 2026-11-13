# MoWorld: gera resources/images/moworld-bg.webp (fundo da tela inicial) a partir
# dos dados do mapa World: terreno do map.bin com a paleta do jogo, texturas do
# mapa e territórios/tribos crescidos a partir das posições reais das nações.
# Rode depois de um build (lê static/maps/world). Requer numpy e pillow.
import json, random, collections
import numpy as np
from PIL import Image
D="/tmp/of/static/maps/world/"; G="/tmp/of/src/client/render/gl/"
man=json.load(open(D+"manifest.json")); W,H=man["map"]["width"],man["map"]["height"]
tb=np.frombuffer(open(D+"map.bin","rb").read(),dtype=np.uint8).reshape(H,W)
rs=json.load(open(G+"render-settings.json"))["terrain"]; th=json.load(open(G+"default-theme.json"))
hx=lambda h:np.array([int(h[i:i+2],16) for i in (1,3,5)],dtype=np.float32)
land=(tb&0x80)>0; shore=(tb&0x40)>0; mag=(tb&0x1f).astype(np.float32)
img=np.zeros((H,W,3),np.float32)
ocean,sand,plains,high,mount=[hx(rs[k]) for k in ("oceanColor","sandColor","plainsColor","highlandColor","mountainColor")]
bg=hx(rs["backgroundColor"])
# mesma lógica do encodeTerrainTile
m=~land & ~shore; img[m]=ocean-np.minimum(mag[m],10)[:,None]
m=~land & shore; img[m]=0.7*ocean+76.5
m=land & shore; img[m]=sand
m=land & ~shore & (mag<10); img[m]=plains; img[m,1]-=2*mag[m]
m=land & ~shore & (mag>=10)&(mag<20); img[m]=np.minimum(255,high+2*(mag[m]-10)[:,None])
m=land & ~shore & (mag>=20); img[m]=np.minimum(255,mount+np.floor(mag[m]/2)[:,None])
img[land&(mag==31)]=bg
# texturas do mapa com as transparências do manifesto
for lay in man["layers"]:
    t=np.asarray(Image.open(D+lay["id"]+".webp").convert("RGBA"),np.float32)
    a=(t[...,3:4]/255)*lay["alpha"]; mask=land if lay["placement"]=="land" else ~land
    img[mask]=img[mask]*(1-a[mask])+t[mask][:, :3]*a[mask]
# territórios: BFS a partir das nações reais, tamanho variado
random.seed(7)
owner=np.full((H,W),-1,np.int32); cost=np.full((H,W),np.inf)
cols=th["nationColors"]; nations=man["nations"]
maxr=[random.choice([20,28,36,46,58,72]) for _ in nations]
import heapq
pq=[]
for i,n in enumerate(nations):
    x,y=n["coordinates"]
    if 0<=x<W and 0<=y<H and land[y,x]:
        cost[y,x]=0; heapq.heappush(pq,(0.0,x,y,i))
rng=np.random.default_rng(7); noise=rng.random((H,W))
steps=[(1,0,1),(-1,0,1),(0,1,1),(0,-1,1),(1,1,1.414),(1,-1,1.414),(-1,1,1.414),(-1,-1,1.414)]
while pq:
    c,x,y,i=heapq.heappop(pq)
    if owner[y,x]!=-1: continue
    owner[y,x]=i
    for dx,dy,w in steps:
        nx,ny=(x+dx)%W,y+dy
        if not(0<=ny<H) or owner[ny,nx]!=-1 or not land[ny,nx] or mag[ny,nx]>=31: continue
        nc=c+w*(0.6+0.9*noise[ny,nx])
        if nc<=maxr[i] and nc<cost[ny,nx]:
            cost[ny,nx]=nc; heapq.heappush(pq,(nc,nx,ny,i))
# tribos: blocos cinza menores nas terras livres
tribe_seeds=0; tries=0; nN=len(nations)
tcols=th.get("classicBotColors") or ["#a0a096"]
while tribe_seeds<170 and tries<20000:
    tries+=1
    x=random.randrange(W); y=random.randrange(110,H-180)
    if land[y,x] and owner[y,x]==-1 and mag[y,x]<20:
        idx=nN+tribe_seeds; maxr.append(random.choice([7,9,11,13])); tribe_seeds+=1
        cost[y,x]=0; heapq.heappush(pq,(0.0,x,y,idx))
while pq:
    c,x,y,i=heapq.heappop(pq)
    if owner[y,x]!=-1: continue
    owner[y,x]=i
    for dx,dy,w in steps:
        nx,ny=(x+dx)%W,y+dy
        if not(0<=ny<H) or owner[ny,nx]!=-1 or not land[ny,nx] or mag[ny,nx]>=31: continue
        nc=c+w*(0.6+0.9*noise[ny,nx])
        if nc<=maxr[i] and nc<cost[ny,nx]:
            cost[ny,nx]=nc; heapq.heappush(pq,(nc,nx,ny,i))
ALPHA=0.68
palette=np.array([hx(cols[i%len(cols)]) for i in range(len(nations))]+[hx(tcols[k%len(tcols)]) for k in range(tribe_seeds)])
own=owner>=0
img[own]=img[own]*(1-ALPHA)+palette[owner[own]]*ALPHA
# borda: tile cujo vizinho tem outro dono → cor do país escurecida
edge=np.zeros_like(own)
for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
    edge|= own & (np.roll(np.roll(owner,dy,0),dx,1)!=owner)
img[edge]=palette[owner[edge]]*0.62
out=Image.fromarray(np.clip(img,0,255).astype(np.uint8))
out=out.crop((0,90,W,H-150))           # tira boa parte dos polos
out=out.resize((out.width*2,out.height*2),Image.NEAREST)
out.save("/tmp/of/resources/images/moworld-bg.webp",quality=82,method=6)
pass
print(out.size)
