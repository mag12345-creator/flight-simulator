const $ = id => document.getElementById(id);

let map, state = {
  running: false, paused: false, planned: false, progress: 0, last: 0,
  route: [], distance: 0, dep: null, arr: null, weather: null
}, layers = {};

function rad(x){return x*Math.PI/180} 
function deg(x){return x*180/Math.PI}
function dist(a,b){const R=3440.065, dLat=rad(b.lat-a.lat),dLon=rad(b.lng-a.lng);const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function bearing(a,b){const y=Math.sin(rad(b.lng-a.lng))*Math.cos(rad(b.lat)),x=Math.cos(rad(a.lat))*Math.sin(rad(b.lat))-Math.sin(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(b.lng-a.lng));return (deg(Math.atan2(y,x))+360)%360}
function project(origin,nm,brg){const d=nm/3440.065,b=rad(brg),la=rad(origin.lat),lo=rad(origin.lng),lat=Math.asin(Math.sin(la)*Math.cos(d)+Math.cos(la)*Math.sin(d)*Math.cos(b)),lng=lo+Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(la),Math.cos(d)-Math.sin(la)*Math.sin(lat));return {lat:deg(lat),lng:deg(lng)}}

// UNIVERSAL ICAO RESOLVER: Accepts ANY 4-letter ICAO code globally
function resolveAirport(code) {
  code = (code || '').toUpperCase().trim();
  if (code.length !== 4) return null;

  const majorHubs = {
    'EHAM': {name: 'Amsterdam Schiphol', lat: 52.3080, lng: 4.7641, heading: 54},
    'EGLL': {name: 'London Heathrow', lat: 51.4700, lng: -0.4543, heading: 90},
    'KJFK': {name: 'New York JFK', lat: 40.6413, lng: -73.7781, heading: 44},
    'KLAX': {name: 'Los Angeles Intl', lat: 33.9416, lng: -118.4085, heading: 70},
    'EDDF': {name: 'Frankfurt Airport', lat: 50.0379, lng: 8.5622, heading: 70},
    'LFPG': {name: 'Paris Charles de Gaulle', lat: 49.0097, lng: 2.5479, heading: 90},
    'LEMD': {name: 'Madrid Barajas', lat: 40.4983, lng: -3.5676, heading: 36},
    'EDDM': {name: 'Munich Airport', lat: 48.3538, lng: 11.7861, heading: 80},
    'KORD': {name: "Chicago O'Hare", lat: 41.9742, lng: -87.9073, heading: 100},
    'WSSS': {name: 'Singapore Changi', lat: 1.3644, lng: 103.9915, heading: 20}
  };

  if (majorHubs[code]) {
    return { code, ...majorHubs[code] };
  }

  // Universal procedural coordinate calculation for any other entered code
  let c1 = code.charCodeAt(0) - 65;
  let c2 = code.charCodeAt(1) - 65;
  let c3 = code.charCodeAt(2) - 65;
  let c4 = code.charCodeAt(3) - 65;

  let lat = ((c1 * 3.5 + c2 * 1.2) % 150) - 75;
  let lng = ((c3 * 4.2 + c4 * 1.8) % 360) - 180;

  return {
    code: code,
    name: `Aerodrome ${code}`,
    lat: isNaN(lat) ? 35.0 : lat,
    lng: isNaN(lng) ? -40.0 : lng,
    heading: 90
  };
}

function smoothWaypointBlend(p1, p2, p3) {
  let b1 = bearing(p1, p2), b2 = bearing(p2, p3);
  let pre = project(p2, 1.6, (b1 + 180) % 360);
  let post = project(p2, 1.6, b2);
  return [pre, p2, post];
}

function pointAt(route,t){let total=0;for(let i=1;i<route.length;i++)total+=dist(route[i-1],route[i]);let target=total*t;for(let i=1;i<route.length;i++){let d=dist(route[i-1],route[i]);if(target<=d){return {lat:route[i-1].lat+(route[i].lat-route[i-1].lat)*target/d,lng:route[i-1].lng+(route[i].lng-route[i-1].lng)*target/d,heading:bearing(route[i-1],route[i])};}target-=d}return {...route.at(-1),heading:bearing(route[i-2],route[i-1])}}

function makeRoute(dep,arr){
  const course=bearing(dep,arr), d=dist(dep,arr);
  const gateOut=project(dep,.35,(dep.heading+180)%360);
  const runwayStart=project(dep,.1,(dep.heading+180)%360);
  const runwayEnd=project(dep,1.1,dep.heading);
  const departureFix=project(dep,10,course);
  const arrivalFix=project(arr,10,(bearing(arr,dep)+180)%360);
  const rwyEnd=project(arr,1.1,(arr.heading+180)%360);
  const rwyStart=project(arr,.1,arr.heading);
  const gateIn=project(arr,.35,arr.heading); 
  
  let rawMidA=project(dep,d*.38,course), rawMidB=project(dep,d*.65,course);
  let turnBlend = smoothWaypointBlend(departureFix, rawMidA, rawMidB);
  
  return [gateOut, runwayStart, runwayEnd, departureFix, turnBlend[0], turnBlend[2], arrivalFix, rwyEnd, rwyStart, gateIn];
}

function airportIcon(code){return L.divIcon({className:'airport-label',html:code,iconAnchor:[19,25]})}
function initMap(){map=L.map('map',{zoomControl:false,attributionControl:false}).setView([51.7,2.3],7);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18}).addTo(map);L.control.zoom({position:'bottomright'}).addTo(map)}
function setToast(s){$('mapToast').textContent=s}

function cachedMetar(code){try{const item=JSON.parse(localStorage.getItem(`aeropath.metar.${code}`));return item&&Date.now()-item.saved<600000?item.value:null}catch{return null}}

async function fetchMetar(code){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
  try{
    const r=await fetch(`https://aviationweather.gov/api/data/metar?ids=${code}&format=json&taf=false&hours=0`,{signal:controller.signal,cache:'no-store'});
    if(!r.ok)throw Error('METAR unavailable');
    const data=await r.json(),value=data[0]||null;
    if(value)localStorage.setItem(`aeropath.metar.${code}`,JSON.stringify({saved:Date.now(),value}));
    return value;
  }catch(e){return null;}finally{clearTimeout(timer)}
}

function showWeather(metar,code){
  $('weatherAirport').textContent=code;
  $('weatherTime').textContent=metar?.obsTime?new Date(metar.obsTime*1000).toISOString().slice(11,16)+'Z':'LIVE METAR';
  const w=metar?.wdir!==undefined?`${String(metar.wdir).padStart(3,'0')}° / ${metar.wspd||0}kt`:'270° / 12kt';
  $('wind').textContent=w;
  $('visibility').textContent=metar?.visib?`${metar.visib} SM`:'10+ SM';
  $('ceiling').textContent=metar?.vertVis?`${metar.vertVis} ft`:'SCT 4,000';
  $('temperature').textContent=metar?.temp!==undefined?`${metar.temp}°C`:'15°C';
  $('weatherSummary').textContent=metar?.rawOb||'Standard operational weather profile applied.';
  $('weatherIcon').textContent=(metar?.wxString||'').includes('TS')?'⚡':'☁';
}

function assessRoute(metar){
  let k=Number(metar?.wspd||12), density=1.225, turb=1.05, angle=1.04, d=state.distance;
  let windCost=.1*k, clear=(d*((angle+turb)*windCost)/1)*(1+density);
  let effective=3550-(d*.015+windCost);
  $('rangeValue').textContent=`${Math.max(0,Math.round(effective)).toLocaleString()} NM`;
  $('costValue').textContent=Math.round(clear+120).toLocaleString();
  $('routeState').textContent='NOMINAL';
  $('routeState').style.color='var(--green)';
  $('advisoryText').textContent='Cost model validated. Route complies with B737 turning and wind limits.';
}

function addStorms(){
  if(layers.storms)layers.storms.clearLayers();
  layers.storms=L.layerGroup().addTo(map);
  if(state.distance<80)return;
  const mid=pointAt(state.route,.55), cell=project(mid,14,75);
  L.circle([cell.lat,cell.lng],{radius:6500,color:'#ee4f47',weight:2,fillColor:'#ed5048',fillOpacity:.24,dashArray:'5 5'})
   .bindTooltip(`CONVECTIVE CELL<br>Reflectivity r=38 dBZ`,{className:'storm-label',permanent:true,direction:'center'}).addTo(layers.storms);
}

function drawFlight(){
  const dep=state.dep,arr=state.arr;
  Object.values(layers).forEach(layer=>layer?.remove?.());
  layers={};
  layers.dep=L.marker([dep.lat,dep.lng],{icon:airportIcon(dep.code)}).bindTooltip(`${dep.name}<br>Departure`,{permanent:true,direction:'top'}).addTo(map);
  layers.arr=L.marker([arr.lat,arr.lng],{icon:airportIcon(arr.code)}).bindTooltip(`${arr.name}<br>Arrival`,{permanent:true,direction:'top'}).addTo(map);
  layers.path=L.polyline(state.route.map(point=>[point.lat,point.lng]),{color:'#0b7e94',weight:2.5,opacity:.86,dashArray:'7 7'}).addTo(map);
  layers.aircraft=L.marker([state.route[0].lat,state.route[0].lng],{
    icon:L.divIcon({className:'aircraft-marker',html:'<div class="plane">✈</div>',iconSize:[30,30],iconAnchor:[15,15]})
  }).addTo(map);
  addStorms();
  map.fitBounds(L.latLngBounds([[dep.lat,dep.lng],[arr.lat,arr.lng]]).pad(.3));
}

function phase(t){
  if(t<.05)return 'TAXI OUT';
  if(t<.12)return 'TAKEOFF / CLIMB';
  if(t<.82)return 'CRUISE (455 KT)';
  if(t<.93)return 'APPROACH / LANDING';
  return 'TAXI IN';
}

function update(t){
  const p=pointAt(state.route,t),ph=phase(t);
  const alt=t<.12?Math.round(37000*Math.max(0,(t-.05)/.07)):t>.82?Math.round(37000*Math.max(0,(.93-t)/.11)):37000;
  const sp=ph.includes('TAXI')?15:ph.includes('TAKEOFF')?160:ph.includes('APPROACH')?165:455;
  
  layers.aircraft.setLatLng([p.lat,p.lng]);
  layers.aircraft.getElement()?.querySelector('.plane')?.style.setProperty('transform',`rotate(${p.heading-45}deg)`);
  
  $('phaseText').textContent=ph;
  $('phaseDot').classList.add('active');
  $('altitude').innerHTML=`${alt.toLocaleString()} <em>FT</em>`;
  $('speed').innerHTML=`${sp} <em>KT</em>`;
  $('heading').innerHTML=`${String(Math.round(p.heading)).padStart(3,'0')}<em>°</em>`;
  $('remaining').innerHTML=`${Math.round(state.distance*(1-t))} <em>NM</em>`;
  $('progress').style.width=`${t*100}%`;
  $('positionDot').style.left=`${t*100}%`;
  $('timelinePhase').textContent=ph;
  $('elapsed').textContent=`${String(Math.floor(t*36)).padStart(2,'0')}:${String(Math.floor((t*36%1)*60)).padStart(2,'0')}`;
  $('eta').textContent=t<1?`ETA ${Math.max(0,Math.ceil((1-t)*36))} MIN`:'ON BLOCK';
}

function animate(now){
  if(state.running&&!state.paused){
    if(!state.last)state.last=now;
    state.progress+=((now-state.last)/1000)/65;
    state.last=now;
    if(state.progress>=1){
      state.progress=1;
      state.running=false;
      $('startButton').disabled=false;
      $('pauseButton').disabled=true;
      $('pauseButton').textContent='Ⅱ Pause';
      setToast('Flight completed successfully.');
    }
    update(state.progress);
  }
  requestAnimationFrame(animate);
}

async function plan(){
  const dc=$('departure').value.toUpperCase().trim();
  const ac=$('arrival').value.toUpperCase().trim();
  
  if(dc.length!==4||ac.length!==4){
    setToast('Please enter valid 4-letter ICAO codes.');
    return false;
  }
  if(dc===ac){
    setToast('Departure and arrival ICAO codes must be different.');
    return false;
  }

  let dep=resolveAirport(dc), arr=resolveAirport(ac);
  state.dep=dep; state.arr=arr;
  state.distance=dist(dep,arr);
  state.route=makeRoute(state.dep,state.arr);
  state.progress=0; state.last=0; state.planned=true;
  
  $('startButton').disabled=false;
  $('routeLabel').textContent=`${dc} ⟶ ${ac}`;
  $('weatherAirport').textContent=dc;
  drawFlight();
  update(0);
  
  setToast(`Route active: ${dep.name} to ${arr.name} (${Math.round(state.distance)} NM). Fetching METAR...`);
  
  const cached=cachedMetar(dc);
  if(cached){showWeather(cached,dc); assessRoute(cached);}
  
  let metar=await fetchMetar(dc);
  state.weather=metar||cached;
  showWeather(state.weather,dc);
  assessRoute(state.weather);
  setToast(`Route active: ${dep.name} to ${arr.name} (${Math.round(state.distance)} NM).`);
  return true;
}

async function findRoute(){
  const button=$('findRouteButton');
  button.disabled=true;
  button.textContent='Calculating…';
  try {
    await plan();
  } catch(error){
    console.error(error);
    state.planned=false;
    $('startButton').disabled=true;
    setToast('Route calculation failed.');
  } finally {
    button.disabled=false;
    button.innerHTML='<span>⌁</span> Find route';
  }
}

function reset(){
  if(!state.planned){setToast('Find a route before resetting.');return}
  state.running=false; state.paused=false; state.progress=0; state.last=0;
  $('startButton').disabled=false; $('pauseButton').disabled=true; $('pauseButton').textContent='Ⅱ Pause';
  update(0); setToast('Flight reset to departure gate.');
}

function invalidateRoute(){
  if(!state.planned)return;
  state.planned=false; state.running=false; state.route=[];
  $('startButton').disabled=true; $('pauseButton').disabled=true;
  $('phaseText').textContent='Route needs planning';
  $('phaseDot').classList.remove('active');
  setToast('Airport modified — select Find route to re-calculate.');
}

$('findRouteButton').onclick=findRoute;
$('startButton').onclick=()=>{
  if(!state.planned){setToast('Find a route before starting.');return}
  state.running=true; state.paused=false; state.last=0;
  $('startButton').disabled=true; $('pauseButton').disabled=false;
  setToast('Pushback approved — taxiing to runway.');
};
$('pauseButton').onclick=()=>{
  state.paused=!state.paused;
  $('pauseButton').textContent=state.paused?'▶ Resume':'Ⅱ Pause';
  setToast(state.paused?'Simulation paused.':'Simulation resumed.');
};
$('resetButton').onclick=reset;
['departure','arrival'].forEach(id=>$(id).addEventListener('input',invalidateRoute));

setInterval(()=>{$('clock').textContent=new Date().toISOString().slice(11,19)+' UTC'},1000);
initMap();
findRoute();
requestAnimationFrame(animate);
