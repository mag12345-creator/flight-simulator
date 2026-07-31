const $ = id => document.getElementById(id);

// Expanded robust airport database covering global hubs & regional nodes
const airports = {
  EHAM:{name:'Amsterdam Schiphol',lat:52.30806,lng:4.76417,heading:54}, EGLL:{name:'London Heathrow',lat:51.4700,lng:-0.4543,heading:90},
  KJFK:{name:'New York JFK',lat:40.6413,lng:-73.7781,heading:44}, KLAX:{name:'Los Angeles',lat:33.9416,lng:-118.4085,heading:70},
  EDDF:{name:'Frankfurt',lat:50.0379,lng:8.5622,heading:70}, LFPG:{name:'Paris Charles de Gaulle',lat:49.0097,lng:2.5479,heading:90},
  LEMD:{name:'Madrid Barajas',lat:40.4983,lng:-3.5676,heading:36}, EDDM:{name:'Munich',lat:48.3538,lng:11.7861,heading:80}, 
  KORD:{name:"Chicago O'Hare",lat:41.9742,lng:-87.9073,heading:100}, WSSS:{name:'Singapore Changi',lat:1.3644,lng:103.9915,heading:20},
  OMDB:{name:'Dubai Int',lat:25.2532,lng:55.3657,heading:120}, YSSY:{name:'Sydney Kingsford Smith',lat:-33.9399,lng:151.1753,heading:160},
  SPJC:{name:'Lima Jorge Chavez',lat:-12.0219,lng:-77.1143,heading:150}, FACT:{name:'Cape Town Int',lat:-33.9648,lng:18.6017,heading:10},
  RJTT:{name:'Tokyo Haneda',lat:35.5494,lng:139.7798,heading:220}, KBOS:{name:'Boston Logan',lat:42.3656,lng:-71.0096,heading:330}
};

let map, state = {
  running: false, paused: false, planned: false, progress: 0, last: 0,
  route: [], distance: 0, dep: null, arr: null, weather: null
}, layers = {};

function rad(x){return x*Math.PI/180} 
function deg(x){return x*180/Math.PI}