import assert from 'node:assert/strict'
import {isMappablePlace,mapSearchPlaces} from '../../app/src/data/mapSearch.ts'
import type {ApiPlaceListItem} from '../../app/src/api/client.ts'
import type {MapHandle} from '../../app/src/native/mapApi.ts'
const place=(id:string,name:string,latitude:number|null,longitude:number|null,extra:Partial<ApiPlaceListItem>={}):ApiPlaceListItem=>({id,name,latitude,longitude,address:'校园中轴路北侧',category:'校园地标',enabled:true,postCount:0,...extra})
const places=[place('a','思源碑',39.95,116.34),place('b','第二食堂',39.95,116.35,{category:'食堂'}),place('c','线上活动',null,null),place('d','威海校区',37.5,122.1),place('e','停用地标',39.95,116.34,{enabled:false}),place('f','无效坐标',NaN,116.34),place('g','越界坐标',999,116.34)]
let west=116.33
const handle={getSize:()=>({width:150,height:200}),project:(lat:number,lng:number)=>({x:(lng-west)*10000,y:(39.96-lat)*10000})} as MapHandle
assert.deepEqual(mapSearchPlaces(places,handle,'' ).map(p=>p.id),['a'])
assert.deepEqual(mapSearchPlaces(places,handle,' 中轴路 ').map(p=>p.id),['a'])
assert.deepEqual(mapSearchPlaces(places,handle,'线上'),[])
assert.deepEqual(mapSearchPlaces(places,handle,'威海'),[])
west=116.345
assert.deepEqual(mapSearchPlaces(places,handle,'').map(p=>p.id),['b'])
assert.deepEqual(mapSearchPlaces(places.filter(p=>p.category==='校园地标'),handle,''),[])
assert.equal(isMappablePlace(places[0]),true,'Places without posts remain searchable')
for(const p of places.slice(2))if(p.id!=='d')assert.equal(isMappablePlace(p),false)
assert.deepEqual(mapSearchPlaces(places,{...handle,getSize:()=>null},''),[])
console.log('PASS map search: same eligible places, viewport pan, name/address, tag source, no-post landmarks, invalid/disabled/nongeographic exclusions')
