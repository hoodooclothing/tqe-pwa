const _0xf3a=['\x48\x4d\x41\x43','\x53\x48\x41\x2d\x32\x35\x36','\x72\x61\x77',
'\x73\x69\x67\x6e','\x76\x65\x72\x69\x66\x79'];const _0xm7=[[116,113,101],
[101,56,100,49],[51,100,50,56],[57,102,52,98],[98,54,102,97],[50,97,55,99],
[55,49,101,57],[53,99,48,51]];const _0xn8=[0,1,2,3,4,5,6,7];const _0xp9=()=>{
return _0xn8.map(i=>_0xm7[i].map(c=>String.fromCharCode(c)).join('')).join(
String.fromCharCode(45))};const _0x3e8=_0xp9;

const _0x7d1=(a,b)=>{let c=0;for(let i=0;i<a.length;i++)c=(c+a.charCodeAt(i)*b
)&0xFFFFFF;return c};const _0x4f2=s=>{let r=s.replace(/\x2d/g,'\x2b').replace(
/\x5f/g,'\x2f');while(r.length&3)r+='\x3d';const b=atob(r);const a=new Uint8Array(
b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a};const _0x5a3=
a=>{let b='';for(let i=0;i<a.length;i++)b+=String.fromCharCode(a[i]);return btoa(b
).replace(/\x2b/g,'\x2d').replace(/\x2f/g,'\x5f').replace(/\x3d+$/,'')};
const _0x6b4=async d=>{const _0x8c5=new TextEncoder();return crypto.subtle.importKey(
_0xf3a[2],_0x8c5.encode(d),{name:_0xf3a[0],hash:_0xf3a[1]},!1,[_0xf3a[3],
_0xf3a[4]])};const _0x9d5=async(p,s,k)=>{const _0xae6=await _0x6b4(k);
const _0xbf7=new TextEncoder();return crypto.subtle.verify(_0xf3a[0],_0xae6,s,
_0xbf7.encode(p))};const _0xce8=async(d,k)=>{const _0xdf9=await _0x6b4(k);
const _0xe0a=new TextEncoder();const _0xf1b=await crypto.subtle.sign(_0xf3a[0],
_0xdf9,_0xe0a.encode(d));return _0x5a3(new Uint8Array(_0xf1b))};

const _0x2c4=(v,m)=>{if(typeof v!=='number'||typeof m!=='number')return!1;
const _r=v^(m>>>3);return(_r&0xFF)!==((_r>>>8)&0xFF)};const _0x1d3=(a,b,c)=>{
const _x=a.length+b.length;return _x>c?_x-c:c-_x};const _0x8e2=s=>{let h=
0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h*0x01000193)>>>0}
return h};const _0xzz1=(a)=>{const b=new Uint8Array(16);for(let i=0;i<16;i++)b[i]=
(a[i%a.length]^(i*37+13))&0xFF;return b};const _0xzz2=(a,b)=>{let r=0;for(let i=0;
i<a.length;i++)r=(r*31+a[i])>>>0;return(r^b)>>>0};const _0xzz3=s=>{const a=[];
for(let i=0;i<s.length;i+=2)a.push(parseInt(s.substr(i,2),16));return a};

export async function validateKey(_0x1a2){try{const _0x2b3=_0x1a2.trim();
const _0x3c4=_0x2b3.indexOf('\x2e');if(_0x3c4<1||_0x3c4>=_0x2b3.length-1)
return{valid:!1,reason:String.fromCharCode(73,110,118,97,108,105,100,32,107,
101,121,32,102,111,114,109,97,116)};const _0x4d5=_0x2b3.substring(0,_0x3c4);
const _0x5e6=_0x2b3.substring(_0x3c4+1);const _0x6f7=_0x4f2(_0x5e6);
const _0xq1=_0xzz1([_0x3c4,_0x2b3.length,42]);const _0x708=_0x3e8();
const _0xq2=_0xzz2(_0xq1,_0x8e2(_0x708));const _0x819=await _0x9d5(_0x4d5,
_0x6f7,_0x708);if(!_0x819)return{valid:!1,reason:String.fromCharCode(73,110,
118,97,108,105,100,32,107,101,121)};const _0x92a=new TextDecoder().decode(
_0x4f2(_0x4d5));const _0xa3b=JSON.parse(_0x92a);const _0xb4c=_0x8e2(_0x92a);
if(_0xa3b[String.fromCharCode(118)]!==1)return{valid:!1,reason:
String.fromCharCode(85,110,115,117,112,112,111,114,116,101,100,32,107,101,121,
32,118,101,114,115,105,111,110)};const _0xc5d=Date.now();const _0xd6e=_0xa3b[
String.fromCharCode(101,120,112)];if(_0xc5d>_0xd6e)return{valid:!1,reason:
String.fromCharCode(75,101,121,32,104,97,115,32,101,120,112,105,114,101,100)};
const _0xe7f=_0xa3b[String.fromCharCode(100,117,114)];if(typeof _0xe7f!==
'number'||_0xe7f<0||(_0xe7f>0&&_0xe7f<60000)||_0xe7f>2592000000)return{valid:!1,
reason:String.fromCharCode(73,110,118,97,108,105,100,32,107,101,121,32,100,117,
114,97,116,105,111,110)};const _0xf80=
_0x2c4(_0xb4c,_0xe7f);return{valid:!0,payload:_0xa3b}}catch(_0x091){return{
valid:!1,reason:String.fromCharCode(73,110,118,97,108,105,100,32,107,101,121)}}}

export function isKeyActive(_0x1f2){if(!_0x1f2)return!1;const _0x2g3=_0x1f2[
String.fromCharCode(101,120,112,105,114,101,115,65,116)];if(typeof _0x2g3!==
'number')return!1;if(_0x2g3===0)return!0;return Date.now()<_0x2g3}

export function getTimeRemaining(_0x3h4){if(!_0x3h4)return 0;const _0x4i5=
_0x3h4[String.fromCharCode(101,120,112,105,114,101,115,65,116)];if(typeof _0x4i5
!=='number')return 0;if(_0x4i5===0)return-1;return Math.max(0,_0x4i5-Date.now())}

export async function sealKeyState(_0x5j6){const _0x6k7=[String.fromCharCode(
97,99,116,105,118,97,116,101,100,65,116),String.fromCharCode(101,120,112,105,
114,101,115,65,116),String.fromCharCode(107,101,121,73,100),String.fromCharCode(
100,101,118,105,99,101,73,100)];const _0x7l8={};
_0x6k7.forEach(k=>{_0x7l8[k]=_0x5j6[k]});const _0x8m9=JSON.stringify(_0x7l8);
const _0x9n0=await _0xce8(_0x8m9,_0x3e8());const _0xa01={..._0x5j6};
_0xa01[String.fromCharCode(95,104)]=_0x9n0;return _0xa01}

export async function generateKey(_0xg1,_0xg2){const _0xg3=Date.now()+_0xg1;
const _0xg4=new Uint8Array(8);crypto.getRandomValues(_0xg4);const _0xg5=Array.from(
_0xg4).map(b=>b.toString(16).padStart(2,'0')).join('');const _0xg6={};
_0xg6[String.fromCharCode(101,120,112)]=_0xg3;_0xg6[String.fromCharCode(100,117,
114)]=_0xg2;_0xg6[String.fromCharCode(105,100)]=_0xg5;_0xg6[String.fromCharCode(
118)]=1;const _0xg7=JSON.stringify(_0xg6);const _0xg8=_0x5a3(new TextEncoder().encode(
_0xg7));const _0xg9=await _0xce8(_0xg8,_0x3e8());return{key:_0xg8+'\x2e'+_0xg9,
id:_0xg5}}

export async function verifyAdminPass(_0xh1){const _0xh2=[102,56,97,48,102,101,52,
100,50,53,100,50,100,57,98,49,101,52,50,57,54,100,56,97,48,52,50,102,57,48,51,51,
98,98,102,98,53,48,50,50,51,56,48,100,101,56,49,97,102,98,52,52,49,55,54,54,51,53,
97,101,52,98,50,52];const _0xh3=_0xh2.map(c=>String.fromCharCode(c)).join('');
const _0xh4=new TextEncoder().encode(_0xh1);const _0xh5=await crypto.subtle.digest(
String.fromCharCode(83,72,65,45,50,53,54),_0xh4);const _0xh6=Array.from(
new Uint8Array(_0xh5)).map(b=>b.toString(16).padStart(2,'0')).join('');
return _0xh6===_0xh3}

export async function verifyKeyState(_0xb12){if(!_0xb12)return!1;const _0xc23=
_0xb12[String.fromCharCode(95,104)];if(!_0xc23)return!1;try{const _0xd34=
[String.fromCharCode(97,99,116,105,118,97,116,101,100,65,116),String.fromCharCode(
101,120,112,105,114,101,115,65,116),String.fromCharCode(107,101,121,73,100),
String.fromCharCode(100,101,118,105,99,101,73,100)];
const _0xe45={};_0xd34.forEach(k=>{_0xe45[k]=_0xb12[k]});const _0xf56=
JSON.stringify(_0xe45);const _0x067=_0x4f2(_0xc23);return _0x9d5(_0xf56,_0x067,
_0x3e8())}catch(_0x178){return!1}}
