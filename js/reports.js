const views={overview:['Ringkasan usaha','Lihat ringkasan omzet, transaksi, dan performa usaha.'],sales:['Analisis penjualan','Pahami tren transaksi, produk terlaris, dan waktu paling ramai.'],products:['Produk & kategori','Bandingkan performa produk, kategori, omzet, dan margin.'],inventory:['Rekap stok','Pantau stok utama, stok kasir, dan mutasi yang tercatat.'],production:['Produksi combo','Telusuri produksi combo, pemakaian bahan, dan bonus penjualan.'],finance:['Biaya & belanja','Pisahkan pembelian bahan dari biaya operasional.'],accounting:['Akuntansi','Lihat ringkasan laba rugi dan posisi kas sederhana.'],payments:['Pembayaran','Lihat penerimaan Cash, QRIS, Online, dan rincian transaksi.'],operations:['Operasional toko','Buka laporan penutup berdasarkan setiap sesi toko.']};
/* KukusanBumi Analytics — read-only Supabase reporting */
const money = n => 'Rp' + Math.round(Number(n)||0).toLocaleString('id-ID');
const num = n => (Number(n)||0).toLocaleString('id-ID');
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
let owner=null, cache={}, currentRange={start:null,end:null};
let paymentPage=1, paymentPageSize=20, paymentMethodFilter='all', paymentSearchQuery='';
let lastSalesForCharts=[];
const tableNames=['products','sales','sale_items','stock_movements','store_sessions','expenses','material_purchases','combos','combo_items','packages','store_settings'];

function setStatus(text,ok=false){const e=$('connectionStatus');if(e){e.textContent=(ok?'● ':'● ')+text;e.classList.toggle('is-ok',ok);e.classList.toggle('is-error',!ok)}}
function showAuth(message=''){ $('authGate').style.display='grid'; $('appShell').hidden=true; $('authMessage').textContent=message; }
function showApp(){ $('authGate').style.display='none'; $('appShell').hidden=false; }
function rangeFromControls(){
 const p=$('period').value;const today=new Date();const iso=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');let start,end;
 if(p==='custom'){start=$('startDate').value||iso(today);end=$('endDate').value||start;if(start>end)[start,end]=[end,start]}
 else if(p==='specific'){start=end=$('anchorDate').value||iso(today)}
 else {const anchor=$('anchorDate').value||iso(today);const d=new Date(anchor+'T12:00:00');start=new Date(d);end=new Date(d);if(p==='week')start.setDate(d.getDate()-6);else if(p==='month'){start=new Date(d.getFullYear(),d.getMonth(),1);end=new Date(d.getFullYear(),d.getMonth()+1,0)}else if(p==='year'){start=new Date(d.getFullYear(),0,1);end=new Date(d.getFullYear(),11,31)}start=iso(start);end=iso(end)}
 currentRange={start,end};return currentRange;
}
function syncDateControls(){const p=$('period').value;const custom=p==='custom';$('anchorDateWrap').hidden=custom;$('startDateWrap').hidden=!custom;$('endDateWrap').hidden=!custom;if(custom){const t=new Date();if(!$('startDate').value)$('startDate').value=localDay(new Date(t.getFullYear(),t.getMonth(),1));if(!$('endDate').value)$('endDate').value=localDay(t)}}

async function fetchAll(table){
 let rows=[],from=0,step=1000;
 while(true){const {data,error}=await supabaseClient.from(table).select('*').eq('user_id',owner.id).range(from,from+step-1);if(error)throw new Error(table+': '+error.message);rows=rows.concat(data||[]);if(!data||data.length<step)break;from+=step;}
 return rows;
}
async function loadData(){
 if(!owner)throw new Error('Sesi login tidak ditemukan.');setStatus('MEMUAT DATA',false);
 const required=['products','sales','sale_items','stock_movements','store_sessions','expenses','material_purchases','combos','packages'];
 const results=await Promise.all(required.map(async t=>[t,await fetchAll(t).catch(e=>({__error:e.message}))]));
 cache={};const errors=[];for(const [t,v] of results){if(v&&v.__error){cache[t]=[];errors.push(v.__error)}else cache[t]=v||[]}
 // combo_items is an optional normalized recipe table; combos.ingredients remains fallback.
 try{cache.combo_items=await fetchAll('combo_items')}catch(e){cache.combo_items=[];errors.push('combo_items: resep terstruktur belum dapat dibaca')}
 try{const {data,error}=await supabaseClient.from('store_settings').select('store_name,logo_url').eq('user_id',owner.id).maybeSingle();if(error)throw error;cache.store_settings=data?[data]:[]}catch(e){cache.store_settings=[]}
 if(errors.length){setStatus('DATA TIDAK LENGKAP',false);$('connectionStatus').title=errors.join(' · ');}
 else $('connectionStatus').title='Terhubung. Data laporan dibaca dari akun owner.';
 if(!errors.length)setStatus('TERHUBUNG',true);$('footerStatus').textContent='Data owner: '+(cache.store_settings[0]?.store_name||'KukusanBumi')+' · diperbarui '+new Date().toLocaleString('id-ID');
 renderAll();
}
const localDay=value=>{if(!value)return '';const raw=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;const d=new Date(value);if(Number.isNaN(d.getTime()))return raw.slice(0,10);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};const within=(date,r)=>{const d=localDay(date);return !!d&&d>=r.start&&d<=r.end};
function renderAll(){const r=rangeFromControls();paymentPage=1;const products=cache.products||[],sales=(cache.sales||[]).filter(s=>within(s.sold_at,r)),saleIds=new Set(sales.map(s=>s.id));const items=(cache.sale_items||[]).filter(i=>saleIds.has(i.sale_id));const expenses=(cache.expenses||[]).filter(x=>within(x.expense_date,r));const purchases=(cache.material_purchases||[]).filter(x=>within(x.purchase_date,r));const movements=(cache.stock_movements||[]).filter(x=>within(x.created_at,r));const sessions=(cache.store_sessions||[]).filter(x=>within(x.business_date,r));
 const revenue=sales.reduce((a,s)=>a+Number(s.total||0),0),cogs=items.reduce((a,i)=>a+Number(i.unit_cost||0)*Number(i.quantity||0),0),expenseTotal=expenses.reduce((a,x)=>a+Number(x.amount||0),0),profit=revenue-cogs-expenseTotal,qty=items.reduce((a,i)=>a+(saleItemKind(i)==='package-header'?0:Number(i.quantity||0)),0),avg=sales.length?revenue/sales.length:0;
 lastSalesForCharts=sales;
 setText('kpiRevenue',money(revenue));setText('kpiProfit',money(profit));setText('kpiTransactions',num(sales.length));setText('salesRevenue',money(revenue));setText('salesCount',num(sales.length));setText('avgTransaction',money(avg));setText('itemsSold',num(qty));setText('activeProducts',num(products.filter(p=>p.is_active!==false).length));setText('damagedCount',num(movements.filter(m=>['damaged','sale_damage'].includes(m.movement_type)).reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0))+' item');setText('movementCount',num(movements.length));
 renderProductTables(items,products);renderProductInsights(items,products);renderStock(products,movements);renderRevenueCharts(sales);renderHours(sales);renderFinancials({revenue,cogs,expenseTotal,profit,expenses,purchases,sales,items});renderPayments(sales);renderOperations(sessions,sales,movements);renderSessionReports(sessions,cache.sales||[],cache.sale_items||[]);renderPaymentTransactions(sales,items);renderCombo(items,products);renderProduction(products,movements,items);renderCosts(expenses,purchases);
}
function setText(id,v){const e=$(id);if(e)e.textContent=v}
function productName(id,products){return products.find(p=>String(p.id)===String(id))?.name||'Produk dihapus / tidak diketahui'}
function saleItemMeta(rowOrValue){
 const raw=typeof rowOrValue==='string'?rowOrValue:String(rowOrValue?.product_name||'');
 const markers=[
  ['__KB_PACKAGE_HEADER__:','package-header'],
  ['__KB_PACKAGE_COMPONENT__:','package-component'],
  ['__KB_PACKAGE_BONUS__:','package-bonus']
 ];
 for(const [prefix,kind] of markers){
  if(raw.startsWith(prefix)){
   try{return {kind,...JSON.parse(raw.slice(prefix.length))}}catch{return {kind,invalid:true}}
  }
 }
 return {kind:'product',productName:raw};
}
function saleItemKind(row){return saleItemMeta(row).kind}
function readableSaleItemName(value){
 const meta=saleItemMeta(value);
 if(meta.kind==='package-header')return meta.packageName||'Paket';
 if(meta.kind==='package-component')return meta.productName||'Komponen paket';
 if(meta.kind==='package-bonus')return 'Bonus: '+(meta.productName||'Produk bonus');
 return meta.productName||'Produk';
}
function groupedSaleItems(rows){
 const packages=new Map(), products=[];
 for(const row of rows||[]){
  const meta=saleItemMeta(row);
  if(meta.kind==='product'){products.push(row);continue;}
  const name=meta.packageName||'Paket tanpa nama';
  if(!packages.has(name))packages.set(name,{name,header:null,components:[],bonuses:[]});
  const group=packages.get(name);
  if(meta.kind==='package-header'){if(!group.header)group.header={...row,quantity:0,line_total:0};group.header.quantity+=Number(row.quantity||0);group.header.line_total+=Number(row.line_total||0);}
  else if(meta.kind==='package-component')group.components.push({row,meta});
  else if(meta.kind==='package-bonus')group.bonuses.push({row,meta});
 }
 return {packages:[...packages.values()],products};
}
function revenueRowsFromItems(items,products){
 const rows=[];
 for(const row of items||[]){
  const meta=saleItemMeta(row);
  if(meta.kind==='package-component'||meta.kind==='package-bonus')continue;
  const isPackage=meta.kind==='package-header';
  const name=isPackage?(meta.packageName||'Paket'):(row.product_name||productName(row.product_id,products));
  rows.push({key:isPackage?'package:'+name:(row.product_id||'snapshot:'+name),name,product_id:isPackage?null:row.product_id,category:isPackage?'Paket':(products.find(p=>String(p.id)===String(row.product_id))?.category||'Tidak diketahui'),qty:Number(row.quantity||0),revenue:Number(row.line_total||0),cost:Number(row.unit_cost||0)*Number(row.quantity||0),isPackage});
 }
 return rows;
}
function saleItemUnitCount(items){return (items||[]).reduce((sum,row)=>sum+(saleItemKind(row)==='package-header'?0:Number(row.quantity||0)),0)}
function packageDetailMarkup(group){
 const header=group.header, packageQty=Number(header?.quantity||0), packagePrice=Number(header?.line_total||0);
 const components=group.components.map(({row,meta})=>{const qty=Number(row.quantity||0);const per=packageQty>0?qty/packageQty:qty;return `<li><span>Isi paket · ${esc(meta.productName||productName(row.product_id,cache.products||[]))}</span><b>×${num(per)} per paket <small>(${num(qty)} total)</small></b></li>`}).join('');
 const bonuses=group.bonuses.map(({row,meta})=>{const qty=Number(row.quantity||0);const per=packageQty>0?qty/packageQty:qty;return `<li class="package-bonus-line"><span>Bonus gratis · ${esc(meta.productName||productName(row.product_id,cache.products||[]))}</span><b>×${num(per)} per paket <small>(${num(qty)} total)</small></b></li>`}).join('');
 return `<div class="txn-package-group"><div class="txn-package-heading"><strong>${esc(group.name)}</strong><span>${packageQty?num(packageQty)+' paket':'Paket'}${header?' · '+money(packagePrice):''}</span></div><ul>${components||'<li><span>Isi paket</span><b>Rincian komponen belum terbaca</b></li>'}${bonuses}</ul></div>`;
}
function saleItemsSearchText(items){
 const group=groupedSaleItems(items);const bits=[];
 group.products.forEach(row=>bits.push(row.product_name||productName(row.product_id,cache.products||[])));
 group.packages.forEach(pkg=>{bits.push(pkg.name);pkg.components.forEach(x=>bits.push(x.meta.productName));pkg.bonuses.forEach(x=>bits.push('bonus '+x.meta.productName));});
 return bits.join(' ').toLowerCase();
}
function renderProductTables(items,products){
 const grouped={};
 revenueRowsFromItems(items,products).forEach(row=>{
  const x=grouped[row.key]||(grouped[row.key]={...row,qty:0,revenue:0,cost:0});
  x.qty+=row.qty;x.revenue+=row.revenue;x.cost+=row.cost;
 });
 const rows=Object.values(grouped).sort((a,b)=>b.revenue-a.revenue);
 const html=rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td>${num(x.qty)}</td><td>${money(x.revenue)}</td><td>${money(x.revenue-x.cost)}</td></tr>`).join('')||'<tr><td colspan="5">Belum ada transaksi pada periode ini.</td></tr>';
 if($('salesRows'))$('salesRows').innerHTML=html;
 if($('categoryRows'))$('categoryRows').innerHTML=rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td>${num(x.qty)}</td><td>${money(x.revenue)}</td><td>${money(x.cost)}</td><td>${money(x.revenue-x.cost)}</td></tr>`).join('')||'<tr><td colspan="6">Belum ada data.</td></tr>';
 if($('bestProducts'))$('bestProducts').innerHTML=rows.slice(0,5).map((x,i)=>`<div class="rank-item"><div class="rank-num">${i+1}</div><div class="rank-name"><b>${esc(x.name)}</b><small>${num(x.qty)} unit/paket terjual</small></div><div class="rank-value">${money(x.revenue)}<small>Omzet</small></div></div>`).join('')||'<p>Belum ada penjualan.</p>';
}
function renderProductInsights(items,products){
 const category={},comboIds=new Set((cache.combos||[]).map(c=>String(c.product_id)));let total=0,comboTotal=0;const rows={};
 revenueRowsFromItems(items,products).forEach(row=>{
  category[row.category]=(category[row.category]||0)+row.revenue;total+=row.revenue;
  if(!row.isPackage&&(comboIds.has(String(row.product_id))||products.find(p=>String(p.id)===String(row.product_id))?.is_combo))comboTotal+=row.revenue;
  const r=rows[row.key]||(rows[row.key]={name:row.name,revenue:0,qty:0,cost:0});r.revenue+=row.revenue;r.qty+=row.qty;r.cost+=row.cost;
 });
 const cats=Object.entries(category).sort((a,b)=>b[1]-a[1]);
 setText('productActiveKpi',num(products.filter(p=>p.is_active!==false).length));const allCategories=new Set(products.map(p=>p.category||'Lainnya'));if(Object.prototype.hasOwnProperty.call(category,'Paket'))allCategories.add('Paket');setText('categoryCountKpi',num(allCategories.size));
 const best=Object.values(rows).sort((a,b)=>b.revenue-a.revenue);setText('topProductKpi',best[0]?.name||'—');setText('comboShareKpi',(total?comboTotal/total*100:0).toFixed(1)+'%');
 const catEl=$('categoryBars');if(catEl)catEl.innerHTML=cats.map(([name,v])=>`<div class="hbar-row" title="${esc(name)} · ${money(v)} omzet"><b>${esc(name)}</b><div class="hbar-track"><div class="hbar-fill" style="width:${total?v/total*100:0}%"></div></div><strong>${total?(v/total*100).toFixed(1):0}%</strong></div>`).join('')||'<p class="muted small">Belum ada penjualan.</p>';
 const profitEl=$('profitProducts');if(profitEl)profitEl.innerHTML=best.slice().sort((a,b)=>(b.revenue-b.cost)-(a.revenue-a.cost)).slice(0,3).map((x,i)=>`<div class="rank-item"><div class="rank-num">${i+1}</div><div class="rank-name"><b>${esc(x.name)}</b><small>Margin ${x.revenue?(100*(x.revenue-x.cost)/x.revenue).toFixed(1):0}%</small></div><div class="rank-value">${money(x.revenue-x.cost)}</div></div>`).join('')||'<p class="muted small">Belum ada data penjualan.</p>';
}
function renderProduction(products,movements,items){const combos=cache.combos||[];setText('comboProductCount',num(combos.filter(c=>c.is_active!==false).length));const comboMoves=movements.filter(m=>m.movement_type==='combo');const bonusMoves=movements.filter(m=>m.movement_type==='bonus');setText('comboMovementQty',num(comboMoves.reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0)));setText('bonusMovementQty',num(bonusMoves.reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0)));setText('comboCostEstimate','—');const recipeEl=$('recipeList');if(recipeEl){const normalized=cache.combo_items||[];recipeEl.innerHTML=combos.map(c=>{const rel=normalized.filter(x=>String(x.combo_id)===String(c.id));let recipe=rel.map(x=>({id:x.product_id,qty:x.quantity}));if(!recipe.length&&Array.isArray(c.ingredients))recipe=c.ingredients.map(x=>({id:x.product_id||x.id,qty:x.qty||x.quantity}));const parts=recipe.map(x=>`${esc(productName(x.id,products))} ×${num(x.qty)}`).join(' + ');return `<div><b>${esc(c.name)}</b><span>→</span><strong>${esc(productName(c.product_id,products))}</strong></div><small>${parts||'Resep belum terbaca'}</small>`}).join('')||'<p class="muted small">Belum ada resep combo.</p>'}}
function renderStock(products,movements){if($('stockRows'))$('stockRows').innerHTML=products.filter(p=>p.is_active!==false).map(p=>`<tr><td>${esc(p.name)}</td><td>${num(p.stock)} unit</td></tr>`).join('')||'<tr><td colspan="2">Belum ada produk.</td></tr>';const types={};movements.forEach(m=>{const t=m.movement_type||'lainnya';types[t]=(types[t]||0)+Math.abs(Number(m.quantity||0))});const body=Object.entries(types).map(([t,q])=>`<tr><td>${esc(t)}</td><td>${num(q)} unit</td><td>${/sold|damaged|reduce/.test(t)?'Keluar':'Masuk / koreksi'}</td><td>Mutasi tercatat</td></tr>`).join('')||'<tr><td colspan="4">Belum ada mutasi pada periode ini.</td></tr>';if($('movementRows'))$('movementRows').innerHTML=body;}

function compactAxis(value,isMoney=false){
 const n=Number(value)||0;if(!isMoney)return num(Math.round(n));
 const a=Math.abs(n);if(a>=1000000)return 'Rp'+(n/1000000).toLocaleString('id-ID',{maximumFractionDigits:1})+' jt';
 if(a>=1000)return 'Rp'+(n/1000).toLocaleString('id-ID',{maximumFractionDigits:0})+' rb';
 return 'Rp'+num(Math.round(n));
}
function chartTooltipContent(detail,value,label){
 if(detail&&typeof detail==='object')return `<strong>${esc(detail.title||label||'Detail')}</strong>${(detail.rows||[]).map(r=>`<div><span>${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join('')}`;
 return `<strong>${esc(label||'Detail')}</strong><div><span>Nilai</span><b>${esc(detail||money(value))}</b></div>`;
}
function canvasChart(id,values,labels,details=[],options={}){
 const c=$(id);if(!c)return;const parent=c.closest('.chart-wrap')||c.parentElement;
 let tooltip=parent.querySelector('.chart-tooltip');if(!tooltip){tooltip=document.createElement('div');tooltip.className='chart-tooltip';tooltip.hidden=true;parent.appendChild(tooltip)}
 const w=Math.max(280,c.clientWidth||parent.clientWidth||500),h=Math.max(170,c.clientHeight||parent.clientHeight||220),dpr=Math.max(1,window.devicePixelRatio||1);
 c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);c.style.width='100%';c.style.height='100%';
 const ctx=c.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
 const pad={l:options.money?58:42,r:16,t:18,b:34},cw=w-pad.l-pad.r,ch=h-pad.t-pad.b;
 const max=Math.max(1,...values)*1.18,step=max/4;
 const points=values.map((v,i)=>({x:pad.l+(values.length<2?cw/2:cw*i/(values.length-1)),y:pad.t+ch-(Number(v)||0)/max*ch}));
 function draw(active=-1){
  ctx.clearRect(0,0,w,h);
  // very light chart background and horizontal guides
  ctx.save();ctx.lineWidth=1;ctx.strokeStyle='#edf0eb';ctx.fillStyle='#92998f';ctx.font='10px "Plus Jakarta Sans",sans-serif';ctx.textAlign='right';
  for(let i=0;i<=4;i++){const val=max*(4-i)/4,y=pad.t+ch*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.fillText(compactAxis(val,!!options.money),pad.l-9,y+3)}
  ctx.restore();
  if(points.length){
   // Soft filled area below the smooth curve
   const area=ctx.createLinearGradient(0,pad.t,0,pad.t+ch);area.addColorStop(0,'rgba(221,126,67,.22)');area.addColorStop(1,'rgba(221,126,67,.015)');
   ctx.beginPath();ctx.moveTo(points[0].x,pad.t+ch);ctx.lineTo(points[0].x,points[0].y);
   for(let i=1;i<points.length;i++){const prev=points[i-1],cur=points[i],mid=(prev.x+cur.x)/2;ctx.quadraticCurveTo(mid,prev.y,cur.x,cur.y)}
   ctx.lineTo(points[points.length-1].x,pad.t+ch);ctx.closePath();ctx.fillStyle=area;ctx.fill();
   // Smooth line
   ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
   for(let i=1;i<points.length;i++){const prev=points[i-1],cur=points[i],mid=(prev.x+cur.x)/2;ctx.quadraticCurveTo(mid,prev.y,cur.x,cur.y)}
   ctx.strokeStyle='#d9783d';ctx.lineWidth=2.8;ctx.lineJoin='round';ctx.lineCap='round';ctx.shadowColor='rgba(217,120,61,.15)';ctx.shadowBlur=7;ctx.stroke();ctx.shadowBlur=0;
   points.forEach((p,i)=>{
    if(i===active){ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fillStyle='rgba(217,120,61,.16)';ctx.fill()}
    ctx.beginPath();ctx.arc(p.x,p.y,i===active?4.8:3.1,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=i===active?2.8:2;ctx.strokeStyle='#d9783d';ctx.stroke();
   });
  }
  // Adaptive x labels so they don't collide
  const maxLabels=Math.max(2,Math.floor(cw/58)),stride=Math.max(1,Math.ceil(labels.length/maxLabels));
  ctx.save();ctx.fillStyle='#899187';ctx.font='9px "Plus Jakarta Sans",sans-serif';ctx.textAlign='center';
  labels.forEach((label,i)=>{if(label&&(i%stride===0||i===labels.length-1)){const x=points[i]?.x??pad.l;ctx.fillText(label,x,h-9)}});ctx.restore();
 }
 function closest(e){const rect=c.getBoundingClientRect(),mx=(e.clientX-rect.left)*(w/rect.width),my=(e.clientY-rect.top)*(h/rect.height);let idx=-1,dist=Infinity;points.forEach((p,i)=>{const d=Math.hypot(p.x-mx,p.y-my);if(d<dist){dist=d;idx=i}});return {idx,dist,mx,my}}
 c.onmousemove=e=>{const hit=closest(e);if(hit.idx>=0&&hit.dist<=24){draw(hit.idx);const d=details[hit.idx];tooltip.innerHTML=chartTooltipContent(d,values[hit.idx],labels[hit.idx]);tooltip.hidden=false;const p=points[hit.idx];const left=Math.max(8,Math.min(w-250,p.x-110));const top=Math.max(6,Math.min(h-90,p.y-78));tooltip.style.left=left+'px';tooltip.style.top=top+'px';}else{draw();tooltip.hidden=true}};
 c.onmouseleave=()=>{draw();tooltip.hidden=true};
 c.onclick=e=>{const hit=closest(e);if(hit.idx>=0&&hit.dist<=28){const d=details[hit.idx];tooltip.innerHTML=chartTooltipContent(d,values[hit.idx],labels[hit.idx]);tooltip.hidden=false;const p=points[hit.idx];tooltip.style.left=Math.max(8,Math.min(w-250,p.x-110))+'px';tooltip.style.top=Math.max(6,Math.min(h-90,p.y-78))+'px'}};
 draw();
}
function buildRevenueBuckets(sales){
 const days=[];const a=new Date(currentRange.start+'T12:00:00'),b=new Date(currentRange.end+'T12:00:00');for(let d=new Date(a);d<=b;d.setDate(d.getDate()+1))days.push(localDay(d));
 let buckets=[];
 if(days.length>120){const map=new Map();days.forEach(day=>{const key=day.slice(0,7);if(!map.has(key))map.set(key,[]);map.get(key).push(day)});buckets=[...map.entries()].map(([key,ds])=>({key,from:ds[0],to:ds[ds.length-1],label:new Date(key+'-01T12:00:00').toLocaleDateString('id-ID',{month:'short'})}));}
 else if(days.length>45){for(let i=0;i<days.length;i+=7){const ds=days.slice(i,i+7);buckets.push({key:ds[0],from:ds[0],to:ds[ds.length-1],label:ds[0].slice(8,10)+'/'+ds[0].slice(5,7)})}}
 else buckets=days.map(day=>({key:day,from:day,to:day,label:day.slice(8,10)+'/'+day.slice(5,7)}));
 return buckets.map(bucket=>{const rows=sales.filter(s=>{const day=localDay(s.sold_at);return day>=bucket.from&&day<=bucket.to});const revenue=rows.reduce((sum,s)=>sum+Number(s.total||0),0);const units=(cache.sale_items||[]).filter(i=>rows.some(s=>String(s.id)===String(i.sale_id))&&saleItemKind(i)!=='package-header').reduce((sum,i)=>sum+Number(i.quantity||0),0);const avg=rows.length?revenue/rows.length:0;return {...bucket,rows,revenue,units,transactions:rows.length,avg}});
}
function renderRevenueCharts(sales){
 const buckets=buildRevenueBuckets(sales);const vals=buckets.map(x=>x.revenue),labels=buckets.map(x=>x.label);
 const details=buckets.map(x=>({title:x.from===x.to?x.from:`${x.from} sampai ${x.to}`,rows:[['Omzet',money(x.revenue)],['Transaksi',num(x.transactions)],['Item terjual',num(x.units)],['Rata-rata transaksi',money(x.avg)]]}));
 canvasChart('revenueChart',vals,labels,details,{money:true});canvasChart('salesChart',vals,labels,details,{money:true});
}
function renderHours(sales){
 const bins=Array.from({length:18},(_,i)=>({hour:i+5,count:0,revenue:0,items:0}));
 sales.forEach(s=>{const d=new Date(s.sold_at),h=d.getHours();if(h>=5&&h<=22){const b=bins[h-5];b.count++;b.revenue+=Number(s.total||0);const saleIds=new Set([String(s.id)]);b.items+=(cache.sale_items||[]).filter(i=>saleIds.has(String(i.sale_id))&&saleItemKind(i)!=='package-header').reduce((a,i)=>a+Number(i.quantity||0),0)}});
 canvasChart('hourChart',bins.map(x=>x.count),bins.map(x=>x.hour%2===1?'':String(x.hour).padStart(2,'0')),bins.map(x=>({title:`${String(x.hour).padStart(2,'0')}:00–${String(x.hour+1).padStart(2,'0')}:00`,rows:[['Transaksi',num(x.count)],['Omzet',money(x.revenue)],['Item terjual',num(x.items)]]})),{money:false});
}
function renderFinancials(o){setText('purchaseTotal',money(o.purchases.reduce((a,x)=>a+Number(x.amount||0),0)));setText('financeRevenue',money(o.revenue));setText('financeCOGS',money(o.cogs));setText('financeExpenses',money(o.expenseTotal));setText('financeProfit',money(o.profit));setText('accountingRevenueKpi',money(o.revenue));setText('accountingGrossKpi',money(o.revenue-o.cogs));setText('accountingExpensesKpi',money(o.expenseTotal));setText('accountingProfitKpi',money(o.profit));setText('accountingRevenue',money(o.revenue));setText('accountingCOGS',money(o.cogs));setText('accountingExpenses',money(o.expenseTotal));setText('accountingProfit',money(o.profit));const financeSummary=document.querySelector('#view-finance .grid-two .finance-lines');if(financeSummary)financeSummary.innerHTML=`<div><span>Omzet penjualan</span><b>${money(o.revenue)}</b></div><div><span>Harga pokok penjualan (HPP)</span><b>− ${money(o.cogs)}</b></div><div><span>Laba kotor</span><b>${money(o.revenue-o.cogs)}</b></div><div><span>Biaya operasional</span><b>− ${money(o.expenseTotal)}</b></div><div class="total"><span>Estimasi laba bersih</span><b>${money(o.profit)}</b></div>`;const els=document.querySelectorAll('#view-accounting .finance-lines');if(els[0])els[0].innerHTML=`<div><span>Penjualan bersih</span><b>${money(o.revenue)}</b></div><div><span>HPP (snapshot unit_cost)</span><b>− ${money(o.cogs)}</b></div><div><span><b>Laba kotor</b></span><b>${money(o.revenue-o.cogs)}</b></div><div><span>Beban operasional</span><b>− ${money(o.expenseTotal)}</b></div><div class="total"><span>Laba bersih estimasi</span><b>${money(o.profit)}</b></div>`;if(els[1])els[1].innerHTML=`<div><span>Penerimaan penjualan</span><b>${money(o.revenue)}</b></div><div><span>Belanja bahan (arus kas)</span><b>− ${money(o.purchases.reduce((a,x)=>a+Number(x.amount||0),0))}</b></div><div><span>Biaya operasional</span><b>− ${money(o.expenseTotal)}</b></div><div class="total"><span>Arus kas sederhana*</span><b>${money(o.revenue-o.expenseTotal-o.purchases.reduce((a,x)=>a+Number(x.amount||0),0))}</b></div>`;}
function paymentLabel(method){return ({cash:'Cash',qris:'QRIS',online:'Online'})[String(method||'').toLowerCase()]||'Tidak diketahui'}
function renderPayments(sales){const sum=m=>sales.filter(s=>String(s.payment_method||'').toLowerCase()===m).reduce((a,s)=>a+Number(s.total||0),0);const cash=sum('cash'),qris=sum('qris'),online=sum('online'),total=cash+qris+online;setText('paymentTotal',money(total));setText('paymentTxnCount',num(sales.length)+' transaksi');setText('cashTotal',money(cash));setText('qrisTotal',money(qris));setText('onlineTotal',money(online));setText('onlineTxnCount',num(sales.filter(s=>String(s.payment_method||'').toLowerCase()==='online').length)+' transaksi');document.querySelectorAll('.donut').forEach(donut=>{const cp=total?cash/total*100:0,qp=total?(cash+qris)/total*100:0;donut.style.background=`conic-gradient(#df7b3d 0 ${cp}%,#5488c7 ${cp}% ${qp}%,#d8ddd6 ${qp}% 100%)`;const b=donut.querySelector('b');if(b)b.textContent=money(total);donut.title=`Cash ${money(cash)} · QRIS ${money(qris)} · Online ${money(online)}`});document.querySelectorAll('.legend-list').forEach(lg=>lg.innerHTML=`<span title="${money(cash)} · ${num(sales.filter(s=>s.payment_method==='cash').length)} transaksi"><i class="cash"></i> Cash <b>${total?(cash/total*100).toFixed(1):0}% · ${money(cash)}</b></span><span title="${money(qris)} · ${num(sales.filter(s=>s.payment_method==='qris').length)} transaksi"><i class="qris"></i> QRIS <b>${total?(qris/total*100).toFixed(1):0}% · ${money(qris)}</b></span><span title="${money(online)} · ${num(sales.filter(s=>s.payment_method==='online').length)} transaksi"><i class="other"></i> Online <b>${total?(online/total*100).toFixed(1):0}% · ${money(online)}</b></span>` )}
function renderPaymentTransactions(sales,items){
 const el=$('paymentTxnRows');if(!el)return;
 const rows=sales.slice().sort((a,b)=>String(b.sold_at).localeCompare(String(a.sold_at))).filter(s=>paymentMethodFilter==='all'||String(s.payment_method||'').toLowerCase()===paymentMethodFilter).filter(s=>{
  if(!paymentSearchQuery)return true;const its=items.filter(i=>String(i.sale_id)===String(s.id));const hay=[s.transaction_code,s.payment_method,s.total,s.sold_at,saleItemsSearchText(its)].join(' ').toLowerCase();return hay.includes(paymentSearchQuery);
 });
 const totalPages=Math.max(1,Math.ceil(rows.length/paymentPageSize));paymentPage=Math.min(Math.max(1,paymentPage),totalPages);
 const start=(paymentPage-1)*paymentPageSize,visible=rows.slice(start,start+paymentPageSize);
 el.innerHTML=visible.map(s=>{
  const its=items.filter(i=>String(i.sale_id)===String(s.id));const count=saleItemUnitCount(its);const time=s.sold_at?new Date(s.sold_at).toLocaleString('id-ID'):'—';
  const grouped=groupedSaleItems(its);
  const normal=grouped.products.map(i=>`<div><span>${esc(i.product_name||productName(i.product_id,cache.products||[]))} × ${num(i.quantity)}</span><strong>${money(i.line_total)}</strong></div>`).join('');
  const packages=grouped.packages.map(packageDetailMarkup).join('');
  return `<tr><td>${esc(time)}</td><td>${esc(s.transaction_code||String(s.id).slice(0,8))}</td><td>${paymentLabel(s.payment_method)}</td><td>${num(count)} unit</td><td>${money(s.total)}</td><td><button class="text-btn txn-detail-btn" data-sale="${esc(s.id)}">Lihat detail</button></td></tr><tr class="txn-detail-row" id="txn-detail-${esc(s.id)}" hidden><td colspan="6"><div class="txn-detail-box"><b>Barang dalam transaksi</b>${normal}${packages||''}${normal||packages?'':'<small>Tidak ada rincian item untuk transaksi ini.</small>'}<div class="txn-detail-total"><span>Subtotal / diskon</span><b>${money(s.subtotal)} / ${money(s.discount)}</b></div><div class="txn-detail-total"><span>Total dibayar · ${paymentLabel(s.payment_method)}</span><b>${money(s.total)}</b></div></div></td></tr>`;
 }).join('')||`<tr><td colspan="6">${sales.length?'Tidak ada transaksi yang cocok dengan filter.':'Belum ada transaksi pada periode ini.'}</td></tr>`;
 renderPaymentPagination(rows.length,totalPages);
}
function renderPaymentPagination(total,totalPages){
 const el=$('paymentPagination');if(!el)return;
 if(!total){el.innerHTML='<span class="pagination-count">0 transaksi</span>';return;}
 const pages=new Set([1,totalPages]);const firstWindow=paymentPage<=2?1:paymentPage-1;const lastWindow=paymentPage<=2?Math.min(3,totalPages):Math.min(totalPages,paymentPage+1);for(let p=firstWindow;p<=lastWindow;p++)pages.add(p);
 const ordered=[...pages].sort((a,b)=>a-b);let buttons='';let prev=0;
 ordered.forEach(p=>{if(prev&&p-prev>1)buttons+='<span class="pagination-ellipsis">…</span>';buttons+=`<button type="button" class="page-btn ${p===paymentPage?'active':''}" data-page="${p}" aria-current="${p===paymentPage?'page':'false'}">${p}</button>`;prev=p});
 el.innerHTML=`<span class="pagination-count">Menampilkan ${num((paymentPage-1)*paymentPageSize+1)}–${num(Math.min(paymentPage*paymentPageSize,total))} dari ${num(total)} transaksi</span><div class="pagination-buttons"><button type="button" class="page-btn page-prev" data-page="${paymentPage-1}" ${paymentPage<=1?'disabled':''}>‹ Sebelumnya</button>${buttons}<button type="button" class="page-btn page-next" data-page="${paymentPage+1}" ${paymentPage>=totalPages?'disabled':''}>Selanjutnya ›</button></div>`;
}
function renderOperations(sessions, sales, movements){
 const rowsEl=$('operationsRows');
 const sessionsList=(sessions||[]).slice().sort((a,b)=>{
  const day=String(b.business_date||'').localeCompare(String(a.business_date||''));
  return day || String(b.opened_at||'').localeCompare(String(a.opened_at||''));
 });
 const allSales=cache.sales||sales||[];
 const allItems=cache.sale_items||[];
 const sessionIds=new Set(sessionsList.map(s=>String(s.id)));
 const sessionSales=allSales.filter(s=>sessionIds.has(String(s.session_id||'')));
 const dailyTotals=new Map();
 sessionsList.forEach(session=>{
  const day=String(session.business_date||'');
  if(!dailyTotals.has(day))dailyTotals.set(day,{revenue:0,target:0,hasTarget:false,achieved:false});
  const aggregate=dailyTotals.get(day);
  const ownSales=sessionSales.filter(s=>String(s.session_id)===String(session.id));
  aggregate.revenue+=ownSales.reduce((sum,s)=>sum+Number(s.total||0),0);
  const target=Number(session.daily_target||0);
  if(target>0){aggregate.target=Math.max(aggregate.target,target);aggregate.hasTarget=true;}
 });
 dailyTotals.forEach((daily,day)=>{
  const daySessions=sessionsList.filter(s=>String(s.business_date||'')===day);
  daily.achieved=daySessions.some(session=>{
   const target=Number(session.daily_target||0);
   if(target<=0)return false;
   const total=sessionSales.filter(s=>String(s.session_id)===String(session.id)).reduce((sum,s)=>sum+Number(s.total||0),0);
   return total>=target;
  });
 });
 const openDays=dailyTotals.size;
 const targetDays=[...dailyTotals.values()].filter(x=>x.achieved).length;
 const dailyRevenue=[...dailyTotals.values()].reduce((sum,x)=>sum+x.revenue,0);
 const waste=(movements||[]).filter(m=>['damaged','sale_damage'].includes(m.movement_type)).reduce((sum,m)=>sum+Math.abs(Number(m.quantity||0)),0);
 setText('openDaysKpi',num(openDays)+' hari');
 setText('targetDaysKpi',num(targetDays)+' hari');
 setText('dailyAverageKpi',money(openDays?dailyRevenue/openDays:0));
 setText('wasteKpi',num(waste)+' item');
 if(!rowsEl)return;
 rowsEl.innerHTML=sessionsList.map(session=>{
  const ownSales=sessionSales.filter(s=>String(s.session_id)===String(session.id));
  const revenue=ownSales.reduce((sum,s)=>sum+Number(s.total||0),0);
  const target=Number(session.daily_target||0);
  const result=target>0?(revenue>=target?'Target tercapai':'Belum tercapai'):'Target belum diatur';
  const opened=session.opened_at?new Date(session.opened_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'—';
  const closed=session.closed_at?new Date(session.closed_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'Belum tutup';
  const date=session.business_date?new Date(String(session.business_date).slice(0,10)+'T12:00:00').toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):'—';
  const status=session.status==='closed'?'Ditutup':'Masih buka';
  return `<tr><td>${esc(date)}<small class="muted table-subtext">${esc(status)}</small></td><td>${esc(opened)}</td><td>${esc(closed)}</td><td>${target>0?money(target):'—'}</td><td><b>${money(revenue)}</b><small class="muted table-subtext">${num(ownSales.length)} transaksi</small></td><td>${esc(result)}</td><td><button type="button" class="text-btn session-report-btn" data-session="${esc(session.id)}">Lihat laporan</button></td></tr>`;
 }).join('')||'<tr><td colspan="7">Belum ada sesi buka-tutup toko pada periode ini.</td></tr>';
}
function renderSessionReports(){
 const rows=$('operationsRows');if(!rows||rows.dataset.reportBound==='1')return;
 rows.dataset.reportBound='1';rows.addEventListener('click',e=>{const button=e.target.closest('.session-report-btn');if(button)openSessionReport(button.dataset.session)});
}
function openSessionReport(sessionId){
 const session=(cache.store_sessions||[]).find(x=>String(x.id)===String(sessionId));if(!session)return;
 const modal=$('sessionReportModal'),content=$('sessionReportContent');if(!modal||!content)return;
 const products=cache.products||[],date=String(session.business_date||'');
 const sales=(cache.sales||[]).filter(x=>String(x.session_id)===String(session.id)).sort((a,b)=>String(a.sold_at).localeCompare(String(b.sold_at)));
 const saleIds=new Set(sales.map(x=>String(x.id)));const items=(cache.sale_items||[]).filter(i=>saleIds.has(String(i.sale_id)));
 const movements=(cache.stock_movements||[]).filter(m=>String(m.session_id||'')===String(session.id));
 const expenses=(cache.expenses||[]).filter(x=>String(x.session_id||'')===String(session.id)||(!x.session_id&&String(x.expense_date||'')===date));
 const purchases=(cache.material_purchases||[]).filter(x=>String(x.purchase_date||'')===date);
 const revenue=sales.reduce((a,s)=>a+Number(s.total||0),0);
 const cogs=items.reduce((a,i)=>a+Number(i.unit_cost||0)*Number(i.quantity||0),0);
 const grossProfit=revenue-cogs;
 const expenseTotal=expenses.reduce((a,x)=>a+Number(x.amount||0),0);
 const purchaseTotal=purchases.reduce((a,x)=>a+Number(x.amount||0),0);
 const bonusMovements=movements.filter(m=>m.movement_type==='bonus');
 const bonusQty=bonusMovements.reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0);
 const manualBonus=bonusMovements.filter(m=>!String(m.note||'').trim().toLowerCase().startsWith('bonus paket '));
 const bonusCost=manualBonus.reduce((a,m)=>a+Math.abs(Number(m.quantity||0))*Number(products.find(p=>String(p.id)===String(m.product_id))?.cost_price||0),0);
 const totalItems=saleItemUnitCount(items);
 const paymentMethods=['cash','qris','online'];
 const paymentRows=paymentMethods.map(method=>{const list=sales.filter(s=>String(s.payment_method||'').toLowerCase()===method);return {method,count:list.length,total:list.reduce((a,s)=>a+Number(s.total||0),0)}});
 const half={};sales.forEach(s=>{const d=new Date(s.sold_at);if(Number.isNaN(d.getTime()))return;d.setMinutes(d.getMinutes()<30?0:30,0,0);const slot=d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',hour12:false});const row=half[slot]||(half[slot]={count:0,revenue:0,items:0});row.count++;row.revenue+=Number(s.total||0);row.items+=saleItemUnitCount(items.filter(i=>String(i.sale_id)===String(s.id)));});
 const perProduct={};revenueRowsFromItems(items,products).forEach(row=>{const x=perProduct[row.key]||(perProduct[row.key]={name:row.name,category:row.category,qty:0,revenue:0,cost:0});x.qty+=row.qty;x.revenue+=row.revenue;x.cost+=row.cost});
 const productRows=Object.values(perProduct).sort((a,b)=>b.revenue-a.revenue).map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.category)}</td><td>${num(x.qty)}</td><td>${money(x.revenue)}</td><td>${money(x.cost)}</td><td>${money(x.revenue-x.cost)}</td></tr>`).join('')||'<tr><td colspan="6">Belum ada penjualan.</td></tr>';
 const plan=session.daily_plan&&typeof session.daily_plan==='object'?session.daily_plan:{};
 const openingStocks=session.daily_opening_stocks&&typeof session.daily_opening_stocks==='object'?session.daily_opening_stocks:{};
 const stockRows=products.map(p=>{
  const planQty=Number(plan[p.id]??0),opening=Number(openingStocks[p.id]??p.stock??0);
  const logs=movements.filter(m=>String(m.product_id)===String(p.id));
  const sum=(types)=>logs.filter(m=>types.includes(m.movement_type)).reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0);
  const sold=items.filter(i=>String(i.product_id)===String(p.id)).reduce((a,i)=>a+Number(i.quantity||0),0);
  const produced=logs.filter(m=>m.movement_type==='combo'&&String(m.note||'').toLowerCase().startsWith('hasil produksi')).reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0);
  const comboUse=logs.filter(m=>m.movement_type==='combo'&&!String(m.note||'').toLowerCase().startsWith('hasil produksi')).reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0);
  const added=sum(['add']),saleAdded=sum(['sale_add']),saleReduced=sum(['sale_reduce']),damaged=sum(['damaged','sale_damage']),bonus=sum(['bonus']);
  const remaining=Math.max(0,planQty-sold);
  return {product:p,opening,planQty,added,produced,sold,saleAdded,saleReduced,damaged,bonus,comboUse,remaining,current:Number(p.stock||0)};
 });
 const stockHtml=stockRows.map(x=>`<tr><td>${esc(x.product.name)}</td><td>${num(x.opening)}</td><td>${num(x.added)}</td><td>${num(x.produced)}</td><td>${num(x.planQty)}</td><td>${num(x.sold)}</td><td>${num(x.saleAdded)}</td><td>${num(x.saleReduced)}</td><td>${num(x.damaged)}</td><td>${num(x.bonus)}</td><td><b>${num(x.remaining)}</b></td><td>${num(x.current)}</td></tr>`).join('')||'<tr><td colspan="12">Belum ada produk.</td></tr>';
 const movementGroups=new Map();movements.filter(m=>m.movement_type==='combo').forEach(m=>{const product=products.find(p=>String(p.id)===String(m.product_id));const note=String(m.note||'').replace(/^(Bahan produksi|Hasil produksi)\s*/i,'').trim()||'Produksi combo';const key=[m.movement_type,m.product_id,note].join('|');if(!movementGroups.has(key))movementGroups.set(key,{name:product?.name||'Produk',note,isOutput:String(m.note||'').toLowerCase().startsWith('hasil produksi'),qty:0,count:0});const x=movementGroups.get(key);x.qty+=Math.abs(Number(m.quantity||0));x.count++});
 const productionRows=[...movementGroups.values()].map(x=>`<tr><td>${x.isOutput?'Hasil produksi':'Bahan digunakan'}</td><td>${esc(x.name)}</td><td>${esc(x.note)}</td><td>${num(x.qty)} unit</td><td>${num(x.count)}</td></tr>`).join('')||'<tr><td colspan="5">Belum ada catatan produksi/pemakaian combo pada sesi ini.</td></tr>';
 const expenseRows=expenses.map(x=>`<tr><td>${esc(x.category||'Lainnya')}</td><td>${esc(x.description||'Biaya operasional')}</td><td>${money(x.amount)}</td></tr>`).join('')||'<tr><td colspan="3">Belum ada biaya operasional pada sesi/tanggal ini.</td></tr>';
 const purchaseRows=purchases.map(x=>`<tr><td>${esc(x.material_name||'Bahan')}</td><td>${esc(x.category||'Lainnya')}</td><td>${x.quantity==null?'—':num(x.quantity)+' '+esc(x.unit||'unit')}</td><td>${money(x.amount)}</td><td>${esc(x.notes||'—')}</td></tr>`).join('')||'<tr><td colspan="5">Belum ada catatan belanja bahan pada tanggal ini.</td></tr>';
 const transactionRows=sales.map(s=>{
  const its=items.filter(i=>String(i.sale_id)===String(s.id));const grouped=groupedSaleItems(its);
  const ordinary=grouped.products.map(row=>`<div class="report-item-line"><span>${esc(row.product_name||productName(row.product_id,products))} × ${num(row.quantity)}</span><b>${money(row.line_total)}</b></div>`).join('');
  const packages=grouped.packages.map(packageDetailMarkup).join('');
  const display=ordinary+packages||'<span class="muted">Rincian item tidak tersedia.</span>';
  return `<tr><td>${s.sold_at?new Date(s.sold_at).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}):'—'}</td><td>${esc(s.transaction_code||String(s.id).slice(0,8))}</td><td>${paymentLabel(s.payment_method)}</td><td><div class="report-transaction-items">${display}</div></td><td><b>${money(s.total)}</b></td></tr>`;
 }).join('')||'<tr><td colspan="5">Belum ada transaksi pada sesi ini.</td></tr>';
 const slots=Object.entries(half).sort((a,b)=>a[0].localeCompare(b[0])).map(([slot,x])=>{const [h,m]=slot.split(':').map(Number);const end=new Date(2000,0,1,h,m+30).toTimeString().slice(0,5);return `<tr><td>${slot}–${end}</td><td>${num(x.count)}</td><td>${num(x.items)}</td><td>${money(x.revenue)}</td></tr>`}).join('')||'<tr><td colspan="4">Belum ada transaksi.</td></tr>';
 const payments=paymentRows.map(x=>`<div><span>${paymentLabel(x.method)} <small class="report-muted">${num(x.count)} transaksi</small></span><b>${money(x.total)}</b></div>`).join('');
 const damageTotal=movements.filter(m=>['damaged','sale_damage'].includes(m.movement_type)).reduce((a,m)=>a+Math.abs(Number(m.quantity||0)),0);
 $('sessionReportTitle').textContent=`Laporan penutup toko · ${date}`;
 content.innerHTML=`
  <div class="session-report-meta"><span class="status ${session.status==='closed'?'good':'warn'}">${session.status==='closed'?'Sesi sudah ditutup':'Sesi masih berjalan'}</span><span>${session.opened_at?'Buka '+new Date(session.opened_at).toLocaleString('id-ID'):'Waktu buka —'}</span><span>${session.closed_at?'Tutup '+new Date(session.closed_at).toLocaleString('id-ID'):'Belum ditutup'}</span></div>
  <div class="session-kpis"><div><small>Total omzet</small><b>${money(revenue)}</b></div><div><small>Transaksi / keranjang</small><b>${num(sales.length)}</b></div><div><small>Item terjual</small><b>${num(totalItems)}</b></div><div><small>Estimasi laba setelah biaya</small><b>${money(grossProfit-expenseTotal-bonusCost)}</b></div></div>
  <div class="report-section"><h3>1. Ringkasan sesi dan hasil keuangan</h3><div class="finance-lines">
   <div><span>Tanggal operasional</span><b>${esc(date||'—')}</b></div><div><span>Target penjualan</span><b>${money(session.daily_target)} · ${revenue>=Number(session.daily_target||0)?'Tercapai':'Belum tercapai'}</b></div><div><span>Modal awal / kas pembuka</span><b>${money(session.opening_cash)}</b></div><div><span>Kas penutupan yang dicatat aplikasi</span><b>${session.closing_cash==null?'Belum dicatat':money(session.closing_cash)}</b></div><div><span>Omzet penjualan</span><b>${money(revenue)}</b></div><div><span>HPP / modal barang terjual</span><b>− ${money(cogs)}</b></div><div><span>Estimasi laba kotor</span><b>${money(grossProfit)}</b></div><div><span>Biaya operasional</span><b>− ${money(expenseTotal)}</b></div><div><span>Belanja bahan (informasi, bukan pengurang laba)</span><b>${money(purchaseTotal)}</b></div><div><span>Bonus gratis tercatat</span><b>${num(bonusQty)} unit</b></div><div><span>Estimasi modal bonus di luar paket</span><b>− ${money(bonusCost)}</b></div><div class="total"><span>Estimasi laba setelah biaya & bonus manual</span><b>${money(grossProfit-expenseTotal-bonusCost)}</b></div>
  </div><p class="muted small">Belanja bahan ditampilkan sebagai catatan arus uang dan tidak dikurangkan lagi dari laba. Bonus paket tidak dihitung sebagai bonus manual karena sudah termasuk dalam HPP paket yang tersimpan.</p></div>
  <div class="report-section"><h3>2. Ringkasan pembayaran</h3><div class="finance-lines">${payments}</div></div>
  <div class="report-section"><h3>3. Penjualan per sesi 30 menit</h3><div class="table-scroll"><table><thead><tr><th>Waktu</th><th>Keranjang selesai</th><th>Item</th><th>Omzet</th></tr></thead><tbody>${slots}</tbody></table></div></div>
  <div class="report-section"><h3>4. Penjualan per produk dan paket</h3><div class="table-scroll"><table><thead><tr><th>Produk / paket</th><th>Kategori</th><th>Terjual</th><th>Omzet</th><th>HPP</th><th>Laba kotor</th></tr></thead><tbody>${productRows}</tbody></table></div></div>
  <div class="report-section"><h3>5. Rekap stok sesi ini</h3><div class="table-scroll"><table><thead><tr><th>Produk</th><th>Stok utama awal</th><th>Stok utama masuk</th><th>Produksi</th><th>Jatah kasir tersimpan</th><th>Terjual/terpakai</th><th>Tambah jatah</th><th>Kurangi jatah</th><th>Rusak/basi</th><th>Bonus</th><th>Estimasi sisa kasir</th><th>Stok utama saat ini</th></tr></thead><tbody>${stockHtml}</tbody></table></div><p class="muted small">Sisa kasir dihitung dari jatah tersimpan pada sesi dikurangi jumlah produk yang tercatat terjual/terpakai, termasuk komponen dan bonus paket. Stok utama saat ini adalah posisi terbaru, bukan snapshot setelah sesi ditutup. Keranjang yang belum diselesaikan tidak tersimpan di Supabase.</p><p class="muted small">Total makanan rusak/basi yang tercatat: <b>${num(damageTotal)} unit</b>.</p></div>
  <div class="report-section"><h3>6. Produksi combo dan pemakaian bahan</h3><div class="table-scroll"><table><thead><tr><th>Jenis</th><th>Produk / bahan</th><th>Nama combo / catatan</th><th>Jumlah</th><th>Catatan</th></tr></thead><tbody>${productionRows}</tbody></table></div></div>
  <div class="report-section"><h3>7. Rincian biaya operasional</h3><div class="table-scroll"><table><thead><tr><th>Kategori</th><th>Keterangan</th><th>Nominal</th></tr></thead><tbody>${expenseRows}</tbody></table></div><div class="report-total-line"><span>Total biaya operasional</span><b>${money(expenseTotal)}</b></div></div>
  <div class="report-section"><h3>8. Catatan belanja bahan</h3><div class="table-scroll"><table><thead><tr><th>Bahan</th><th>Kategori</th><th>Jumlah</th><th>Total belanja</th><th>Catatan</th></tr></thead><tbody>${purchaseRows}</tbody></table></div><div class="report-total-line"><span>Total belanja bahan (informasi)</span><b>${money(purchaseTotal)}</b></div><p class="muted small">Pembelian bahan tidak otomatis menambah atau mengurangi stok master karena tabel pembelian belum terhubung dengan master bahan baku.</p></div>
  <div class="report-section"><h3>9. Rincian transaksi pada sesi ini</h3><div class="table-scroll"><table><thead><tr><th>Jam</th><th>Kode transaksi</th><th>Metode</th><th>Barang yang dibeli / isi paket</th><th>Total keranjang</th></tr></thead><tbody>${transactionRows}</tbody></table></div></div>
  ${session.notes?`<div class="info-strip"><b>Catatan sesi:</b> ${esc(session.notes)}</div>`:''}
 `;
 modal.showModal();
}
function renderCombo(items,products){const combos=cache.combos||[];const sellable=revenueRowsFromItems(items,products);const rows=combos.map(c=>{const related=sellable.filter(i=>String(i.product_id)===String(c.product_id));return {name:c.name,qty:related.reduce((a,i)=>a+i.qty,0),revenue:related.reduce((a,i)=>a+i.revenue,0)}}).sort((a,b)=>b.revenue-a.revenue);const el=$('comboBars');if(el)el.innerHTML=rows.map(x=>`<div class="hbar-row" title="${esc(x.name)} · ${num(x.qty)} terjual · ${money(x.revenue)} omzet"><b>${esc(x.name)}</b><div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1,x.revenue/(rows[0]?.revenue||1)*100)}%"></div></div><strong>${num(x.qty)}</strong></div>`).join('')||'<p>Belum ada resep combo.</p>'}
function renderCosts(expenses,purchases){const grids=document.querySelectorAll('#view-finance .grid-two');if(grids.length<2)return;const groups={};expenses.forEach(x=>groups[x.category||'Lainnya']=(groups[x.category||'Lainnya']||0)+Number(x.amount||0));const lines=Object.entries(groups).map(([k,v])=>`<div><span>${esc(k)}</span><b>${money(v)}</b></div>`).join('')||'<div><span>Belum ada biaya</span><b>Rp0</b></div>';const first=grids[1].querySelector('.finance-lines');if(first)first.innerHTML=lines+`<div class="total"><span>Total biaya operasional</span><b>${money(expenses.reduce((a,x)=>a+Number(x.amount||0),0))}</b></div>`;const groupsP={};purchases.forEach(x=>groupsP[x.category||'Lainnya']=(groupsP[x.category||'Lainnya']||0)+Number(x.amount||0));const second=grids[1].querySelectorAll('.finance-lines')[1];if(second)second.innerHTML=(Object.entries(groupsP).map(([k,v])=>`<div><span>${esc(k)}</span><b>${money(v)}</b></div>`).join('')||'<div><span>Belum ada pembelian</span><b>Rp0</b></div>')+`<div class="total"><span>Total pembelian bahan</span><b>${money(purchases.reduce((a,x)=>a+Number(x.amount||0),0))}</b></div>`;}
async function login(e){e.preventDefault();const btn=$('authSubmit'),msg=$('authMessage');btn.disabled=true;msg.textContent='Memeriksa akun…';try{const {data,error}=await supabaseClient.auth.signInWithPassword({email:$('authEmail').value.trim(),password:$('authPassword').value});if(error)throw error;owner=data.user;showApp();await loadData()}catch(err){console.error(err);msg.textContent='Gagal masuk atau memuat laporan: '+err.message;showAuth(msg.textContent)}finally{btn.disabled=false}}
async function boot(){$('anchorDate').value=localDay(new Date());syncDateControls();if(typeof supabaseClient==='undefined'){showAuth('Konfigurasi Supabase tidak termuat. Pastikan js/supabase-config.js tersedia.');return}supabaseClient.auth.onAuthStateChange(async(event,session)=>{if(event==='SIGNED_OUT'){owner=null;showAuth('Sesi telah berakhir. Silakan masuk kembali.')}});try{const {data,error}=await supabaseClient.auth.getSession();if(error)throw error;if(data.session){owner=data.session.user;showApp();await loadData()}else showAuth()}catch(e){showAuth(e.message)}}
$('authForm').addEventListener('submit',login);$('logoutBtn').addEventListener('click',async()=>{await supabaseClient.auth.signOut();});$('refreshBtn').addEventListener('click',async()=>{const b=$('refreshBtn');b.disabled=true;b.textContent='Memuat…';try{await loadData();b.textContent='✓ Diperbarui'}catch(e){setStatus('GAGAL MEMUAT',false);$('connectionStatus').title=e.message;b.textContent='Coba lagi'}finally{setTimeout(()=>{b.disabled=false;b.textContent='↻ Perbarui'},1200)}});$('period').addEventListener('change',()=>{syncDateControls();if(owner)renderAll()});['anchorDate','startDate','endDate'].forEach(id=>$(id).addEventListener('change',()=>{if(owner)renderAll()}));
document.querySelectorAll('.nav-link').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.goto)));function showView(v){document.querySelectorAll('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view===v));document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-'+v));if(typeof views!=='undefined'&&views[v]){$('pageTitle').textContent=views[v][0];$('crumbTitle').textContent=views[v][0];$('pageDesc').textContent=views[v][1]}$('sidebar').classList.remove('open');window.scrollTo(0,0);if(v==='overview'||v==='sales'){requestAnimationFrame(()=>{renderRevenueCharts(lastSalesForCharts);renderHours(lastSalesForCharts)})}}
$('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));$('paymentTxnRows').addEventListener('click',e=>{const b=e.target.closest('.txn-detail-btn');if(!b)return;const row=$('txn-detail-'+b.dataset.sale);if(row)row.hidden=!row.hidden});$('paymentSearch').addEventListener('input',e=>{paymentSearchQuery=e.target.value.trim().toLowerCase();paymentPage=1;renderPaymentTransactions((cache.sales||[]).filter(s=>within(s.sold_at,currentRange)),(cache.sale_items||[]).filter(i=>(cache.sales||[]).some(s=>String(s.id)===String(i.sale_id)&&within(s.sold_at,currentRange))));});$('paymentMethodFilter').addEventListener('change',e=>{paymentMethodFilter=e.target.value;paymentPage=1;renderPaymentTransactions((cache.sales||[]).filter(s=>within(s.sold_at,currentRange)),(cache.sale_items||[]).filter(i=>(cache.sales||[]).some(s=>String(s.id)===String(i.sale_id)&&within(s.sold_at,currentRange))));});$('paymentPagination').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(!b||b.disabled)return;paymentPage=Number(b.dataset.page)||1;renderPaymentTransactions((cache.sales||[]).filter(s=>within(s.sold_at,currentRange)),(cache.sale_items||[]).filter(i=>(cache.sales||[]).some(s=>String(s.id)===String(i.sale_id)&&within(s.sold_at,currentRange))));});$('closeSessionReport').addEventListener('click',()=>$('sessionReportModal').close());$('printSessionReport').addEventListener('click',()=>window.print());['productSearch','categorySearch','stockSearch'].forEach(id=>$(id)?.addEventListener('input',e=>{const target=id==='productSearch'?'salesRows':id==='categorySearch'?'categoryRows':'stockRows';document.querySelectorAll('#'+target+' tr').forEach(tr=>tr.hidden=!tr.textContent.toLowerCase().includes(e.target.value.toLowerCase()))}));
boot();
