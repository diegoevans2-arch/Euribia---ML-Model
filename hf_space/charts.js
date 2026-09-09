/* Gráficos sin dependencias: SVG para lo pequeño, canvas para el scatter de miles de puntos. */

const C = {real:'var(--real)', pred:'var(--pred)', naive:'var(--naive)',
           good:'var(--good)', bad:'var(--bad)'};

const escHtml = s => String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function legend(items){
  return `<div class="legend">${items.map(i=>
    `<span><i style="background:${i.color}"></i>${escHtml(i.name)}</span>`).join('')}</div>`;
}

function lineChart(series, opts={}){
  const W=opts.w||620, H=opts.h||260, P={t:16,r:16,b:34,l:56};
  const all = series.flatMap(s=>s.pts);
  const xs=all.map(p=>p[0]), ys=all.map(p=>p[1]);
  let x0=Math.min(...xs), x1=Math.max(...xs);

  /* ESCALA LOGARÍTMICA opcional. Sirve cuando conviven series de órdenes de
     magnitud distintos —el escenario p25 abre 2,5x más secciones que la norma— y
     en lineal las de abajo quedan aplastadas contra el eje.
     El piso en 1 no es cosmético: log(0) es −infinito y una sola serie en cero
     rompería toda la escala. Con secciones, «1» es además el mínimo real. */
  const lg = !!opts.log;
  const T = v => lg ? Math.log10(Math.max(v,1)) : v;      // al espacio del gráfico
  const T1 = u => lg ? Math.pow(10,u) : u;                // y de vuelta, para rotular

  const tys = ys.map(T);
  let y0 = opts.y0!=null && !lg ? opts.y0 : Math.min(...tys);
  let y1 = Math.max(...tys);
  if(lg){ y0=Math.floor(y0); y1=Math.ceil(y1); if(y1===y0) y1=y0+1; }
  else { const pad=(y1-y0)*0.12||1; y0-=pad; y1+=pad; }

  const X=v=>P.l+(v-x0)/((x1-x0)||1)*(W-P.l-P.r);
  const Y=v=>H-P.b-(T(v)-y0)/((y1-y0)||1)*(H-P.t-P.b);
  const Yu=u=>H-P.b-(u-y0)/((y1-y0)||1)*(H-P.t-P.b);      // desde el espacio ya transformado
  let g='';
  const nGrid = lg ? Math.min(y1-y0,6) : 4;
  for(let i=0;i<=nGrid;i++){ const u=y0+(y1-y0)*i/nGrid, v=T1(u);
    g+=`<line x1="${P.l}" y1="${Yu(u)}" x2="${W-P.r}" y2="${Yu(u)}" stroke="var(--line)" stroke-width="1"/>`;
    g+=`<text x="${P.l-8}" y="${Yu(u)+4}" text-anchor="end" font-size="10" fill="var(--muted)">${opts.fy?opts.fy(v):F.n(v)}</text>`;}
  /* Etiquetas del eje X. Dos cosas que el gráfico de períodos necesita y el
     original no hacía:
       · `opts.fx` traduce el valor del eje a su etiqueta. Cuando el eje es
         CATEGÓRICO (0,1,2…) el número del eje no es lo que hay que escribir.
       · se saltan etiquetas si no caben. Con 12 períodos y ~46 px por etiqueta
         se solapaban unas con otras («2022002220»); ahora se muestra una de cada
         `paso`, calculado por el ancho disponible. */
  const _u = xs.filter((v,i,a)=>a.indexOf(v)===i).sort((a,b)=>a-b);
  const _anchoEtq = opts.anchoEtq || 46;
  const _paso = Math.max(1, Math.ceil(_u.length / Math.floor((W-P.l-P.r)/_anchoEtq)));
  _u.forEach((v,i)=>{
    if(i % _paso && i !== _u.length-1) return;         // el último siempre se muestra
    const _txt = opts.fx ? opts.fx(v) : v;
    g+=`<text x="${X(v)}" y="${H-12}" text-anchor="middle" font-size="10" fill="var(--muted)">${_txt}</text>`;});
  series.forEach(s=>{
    const d=s.pts.map((p,i)=>(i?'L':'M')+X(p[0])+' '+Y(p[1])).join(' ');
    g+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w||2}"
         stroke-dasharray="${s.dash||''}" stroke-linejoin="round"/>`;
    s.pts.forEach(p=>{ g+=`<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${s.r||3.2}"
         fill="${s.color}"><title>${opts.fx?opts.fx(p[0]):p[0]} · ${s.name?s.name+': ':''}${F.n(p[1])}</title></circle>`;});
  });
  (opts.marks||[]).forEach(m=>{
    g+=`<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="8" fill="none" stroke="${m.color}" stroke-width="2.5"/>`;
    g+=`<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="3.4" fill="${m.color}"><title>${escHtml(m.label)}</title></circle>`;});

  /* HOVER UNIFICADO POR COLUMNA. Una banda invisible sobre cada valor de X captura
     el puntero en toda la altura del gráfico, así no hay que apuntar al punto —que
     con 3 px de radio es incómodo— y además se muestran TODAS las series de ese
     período a la vez, que es la comparación que interesa. Es el `hovermode='x
     unified'` de plotly, hecho a mano.
     El binding vive en app.js: aquí sólo se marcan las bandas con data-i. */
  if(opts.hover){
    const u=[...new Set(xs)].sort((a,b)=>a-b);
    const bw=u.length>1 ? (X(u[1])-X(u[0])) : (W-P.l-P.r);
    u.forEach(v=>{
      g+=`<rect class="hb" data-x="${v}" x="${X(v)-bw/2}" y="${P.t}" width="${bw}"
           height="${H-P.t-P.b}" fill="transparent" style="cursor:crosshair"/>`;});
    g+=`<line class="hrule" x1="0" y1="${P.t}" x2="0" y2="${H-P.b}"
         stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

function hBars(rows, opts={}){
  const W=opts.w||620, rh=opts.rh||21, P={t:6,r:62,b:6,l:opts.l||184};
  const H=P.t+P.b+rows.length*rh;
  const vals=rows.map(r=>r.v);
  let x0=Math.min(0,...vals), x1=Math.max(...vals); if(x1===x0)x1=x0+1;
  const X=v=>P.l+(v-x0)/(x1-x0)*(W-P.l-P.r);
  let g='';
  if(x0<0) g+=`<line x1="${X(0)}" y1="${P.t}" x2="${X(0)}" y2="${H-P.b}" stroke="var(--muted)"/>`;
  rows.forEach((r,i)=>{ const y=P.t+i*rh;
    const xa=Math.min(X(r.v),X(0)), w=Math.abs(X(r.v)-X(0));
    g+=`<text x="${P.l-8}" y="${y+rh/2+4}" text-anchor="end" font-size="11" fill="var(--ink)">${escHtml(r.k)}</text>`;
    g+=`<rect x="${xa}" y="${y+3}" width="${Math.max(w,1)}" height="${rh-8}" rx="2" fill="${r.color||C.pred}">
        <title>${escHtml(r.k)}: ${opts.fv?opts.fv(r.v):F.n(r.v,2)}</title></rect>`;
    g+=`<text x="${W-P.r+6}" y="${y+rh/2+4}" font-size="10.5" fill="var(--muted)">${opts.fv?opts.fv(r.v):F.n(r.v,2)}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
}

/* ---------- scatter en canvas: soporta miles de puntos con hover ---------- */
function scatterCanvas(canvas, pts, opts={}){
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 520, cssH = opts.h || 420;
  canvas.width = cssW*dpr; canvas.height = cssH*dpr;
  canvas.style.height = cssH+'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);

  const st = getComputedStyle(document.body);
  const cLine = st.getPropertyValue('--line').trim() || '#e5e4e0';
  const cMuted = st.getPropertyValue('--muted').trim() || '#888';
  const cDot = st.getPropertyValue('--dot').trim() || 'rgba(224,123,57,.42)';
  const cIdent = st.getPropertyValue('--real').trim() || '#1b3a5c';

  const P = {t:14, r:14, b:40, l:56};
  const log = !!opts.log;
  const vals = pts.flatMap(p=>[p[0], p[1]]).filter(v=>v>0 || !log);
  let hi = Math.max(...vals, 1);
  let lo = log ? Math.max(1, Math.min(...vals.filter(v=>v>0))) : 0;
  hi *= 1.05;

  const tx = v => log ? Math.log10(Math.max(v, lo)) : v;
  const X = v => P.l + (tx(v)-tx(lo))/((tx(hi)-tx(lo))||1)*(cssW-P.l-P.r);
  const Y = v => cssH-P.b - (tx(v)-tx(lo))/((tx(hi)-tx(lo))||1)*(cssH-P.t-P.b);

  // ticks
  const ticks = [];
  if(log){ for(let e=Math.floor(Math.log10(lo)); e<=Math.ceil(Math.log10(hi)); e++) ticks.push(Math.pow(10,e)); }
  else { for(let i=0;i<=4;i++) ticks.push(lo+(hi-lo)*i/4); }
  ctx.strokeStyle=cLine; ctx.fillStyle=cMuted; ctx.lineWidth=1;
  ctx.font='10px ui-sans-serif,system-ui,sans-serif';
  ticks.forEach(v=>{
    if(v>hi) return;
    ctx.beginPath(); ctx.moveTo(P.l,Y(v)); ctx.lineTo(cssW-P.r,Y(v)); ctx.stroke();
    ctx.textAlign='right'; ctx.textBaseline='middle';
    ctx.fillText(F.compact(v), P.l-7, Y(v));
    ctx.beginPath(); ctx.moveTo(X(v),cssH-P.b); ctx.lineTo(X(v),P.t); ctx.stroke();
    ctx.textAlign='center'; ctx.textBaseline='top';
    ctx.fillText(F.compact(v), X(v), cssH-P.b+7);
  });

  // identidad
  ctx.strokeStyle=cIdent; ctx.setLineDash([5,4]); ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(X(lo),Y(lo)); ctx.lineTo(X(hi),Y(hi)); ctx.stroke();
  ctx.setLineDash([]);

  // puntos: p[3] es el índice de serie y elige color en opts.palette; sin palette, todo en --dot.
  // Radio y opacidad salen de cuántos puntos trae cada serie: los agregados gruesos son pocos
  // y grandes, las celdas finas muchas y translúcidas.
  const pal = opts.palette;
  const sizeOf  = n => n>3000 ? 1.7 : n>800 ? 2.4 : n>100 ? 3.2 : 4.6;
  const alphaOf = n => n>3000 ? .38 : n>800 ? .50 : n>100 ? .72 : .95;

  const scr = [];
  const series = new Map();
  pts.forEach(p=>{
    if(log && (p[0]<=0 || p[1]<=0)) return;
    const x=X(p[0]), y=Y(p[1]);
    scr.push([x,y,p]);
    const k = pal ? (p[3]|0) : 0;
    let a = series.get(k); if(!a){ a=[]; series.set(k,a); }
    a.push(x,y);
  });

  // de la serie más poblada a la menos, para que los pocos puntos gruesos queden encima
  let rMax = 0;
  for(const k of [...series.keys()].sort((a,b)=>series.get(b).length-series.get(a).length)){
    const a = series.get(k), n = a.length/2, rk = sizeOf(n);
    rMax = Math.max(rMax, rk);
    ctx.fillStyle   = pal ? pal[k % pal.length] : cDot;
    ctx.globalAlpha = pal ? alphaOf(n) : 1;
    ctx.beginPath();                       // un solo path por serie: 20k puntos sin ahogarse
    for(let i=0;i<a.length;i+=2){ ctx.moveTo(a[i]+rk, a[i+1]); ctx.arc(a[i],a[i+1],rk,0,6.2832); }
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ejes
  ctx.fillStyle=cMuted; ctx.font='11px ui-sans-serif,system-ui,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText(opts.xlab||'', (cssW+P.l)/2, cssH-2);
  ctx.save(); ctx.translate(11,(cssH-P.b+P.t)/2); ctx.rotate(-Math.PI/2);
  ctx.textBaseline='top'; ctx.fillText(opts.ylab||'',0,0); ctx.restore();

  return {scr, cssW, cssH, r:Math.max(rMax,4)};
}

/* ---------- dot plot de Cleveland: una fila por categoría, un punto por serie ----------
   Se renderiza al ancho real del contenedor en vez de escalar un viewBox fijo: escalando,
   las etiquetas del eje Y quedarían ilegibles en móvil.
   rows   : [{label, pts:[{s, v}]}]   s = índice de serie
   series : [{name, color, hi}]       hi marca la serie destacada
   Los círculos llevan data-r y data-s para que quien llama arme el tooltip con sus datos. */
function dotPlot(rows, series, opts={}){
  const W = Math.max(opts.w || 640, 300);
  const gut = Math.max(Math.min(opts.gutter || W*0.30, 260), 84);   // canal de etiquetas
  const rh = opts.rh || 30, P = {t:8, r:22, b:34, l:gut};
  const H = P.t + P.b + rows.length*rh;
  const vals = rows.flatMap(r=>r.pts.flatMap(p=>p.lo!=null?[p.v,p.lo,p.hi]:[p.v]));
  if(!vals.length) return '';
  let x0 = Math.min(0, ...vals), x1 = Math.max(0, ...vals);
  if(x1===x0) x1 = x0 + 1;
  const pad = (x1-x0)*0.04; x1 += pad; if(x0<0) x0 -= pad;
  const X = v => P.l + (v-x0)/(x1-x0)*(W-P.l-P.r);
  const fv = opts.fv || (v=>F.n(v));
  let g = '';

  // bandas alternas: con 25 filas ayudan a no perder el renglón al recorrer con la vista
  rows.forEach((r,i)=>{ if(i%2) g += `<rect x="0" y="${P.t+i*rh}" width="${W}" height="${rh}"
      fill="var(--chip)" opacity=".55"/>`; });

  // rejilla y eje X
  for(let i=0;i<=4;i++){
    const v = x0 + (x1-x0)*i/4, x = X(v);
    g += `<line x1="${x}" y1="${P.t}" x2="${x}" y2="${H-P.b}" stroke="var(--line)" stroke-width="1"/>`;
    g += `<text x="${x}" y="${H-P.b+16}" text-anchor="middle" font-size="10"
           fill="var(--muted)">${escHtml(opts.fx ? opts.fx(v) : F.compact(v))}</text>`;
  }
  if(x0 < 0){ const z = X(0);
    g += `<line x1="${z}" y1="${P.t}" x2="${z}" y2="${H-P.b}" stroke="var(--muted)" stroke-width="1.4"/>`; }

  rows.forEach((r,i)=>{
    const cy = P.t + i*rh + rh/2;
    const vs = r.pts.map(p=>p.v);
    // conector min→max: es lo que convierte puntos sueltos en una comparación legible
    if(r.pts.length>1)
      g += `<line x1="${X(Math.min(...vs))}" y1="${cy}" x2="${X(Math.max(...vs))}" y2="${cy}"
             stroke="var(--muted)" stroke-width="1.6" opacity=".42"/>`;
    g += `<text x="${P.l-11}" y="${cy+4}" text-anchor="end" font-size="11.5"
           fill="var(--ink)">${escHtml(r.label)}<title>${escHtml(r.full||r.label)}</title></text>`;
    // la destacada al final, para que quede por encima de las demás
    const orden = [...r.pts].sort((a,b)=>(series[a.s].hi?1:0)-(series[b.s].hi?1:0));
    // Las barras van primero, todas, para que ningún punto quede tapado por la barra de otro.
    // Se desplazan verticalmente cuando hay varias series: superpuestas serían ilegibles.
    const nb = orden.filter(p=>p.lo!=null).length;
    let ib = 0;
    orden.forEach(p=>{
      if(p.lo==null) return;
      const off = nb>1 ? (ib-(nb-1)/2)*Math.min(5, (rh-10)/nb) : 0;
      const yy = cy+off, se = series[p.s];
      g += `<line x1="${X(p.lo)}" y1="${yy}" x2="${X(p.hi)}" y2="${yy}"
             stroke="${se.color}" stroke-width="1.6" opacity=".5"/>`;
      for(const xv of [p.lo, p.hi])
        g += `<line x1="${X(xv)}" y1="${yy-3.5}" x2="${X(xv)}" y2="${yy+3.5}"
               stroke="${se.color}" stroke-width="1.6" opacity=".5"/>`;
      ib++;
    });
    orden.forEach(p=>{
      const se = series[p.s], rr = se.hi ? 7.5 : 5.2;
      g += `<circle cx="${X(p.v)}" cy="${cy}" r="${rr}" fill="${se.color}"
             stroke="var(--panel)" stroke-width="${se.hi?2.4:1.2}"
             data-r="${i}" data-s="${p.s}" style="cursor:pointer"/>`;
    });
  });

  g += `<text x="${P.l+(W-P.l-P.r)/2}" y="${H-3}" text-anchor="middle" font-size="11"
         fill="var(--muted)">${escHtml(opts.xlab||'')}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
           style="max-width:100%;height:auto">${g}</svg>`;
}

/* tooltip compartido para el scatter */
let _tipEl=null;
function tipShow(html, x, y){
  if(!_tipEl){ _tipEl=document.createElement('div'); _tipEl.className='tip'; document.body.appendChild(_tipEl); }
  _tipEl.innerHTML=html; _tipEl.classList.add('on');
  const r=_tipEl.getBoundingClientRect();
  _tipEl.style.left = Math.min(x+14, window.innerWidth-r.width-10)+'px';
  _tipEl.style.top  = Math.max(y-r.height-12, 8)+'px';
}
function tipHide(){ if(_tipEl) _tipEl.classList.remove('on'); }
