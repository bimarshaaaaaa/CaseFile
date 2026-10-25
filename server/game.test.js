import test from 'node:test';
import assert from 'node:assert/strict';
import { GameHub } from './game.js';

function fakeIo(){return {events:[],to(id){return {emit:(event,payload)=>this.events.push({id,event,payload})}},emit(){}}}
function fakeSocket(id){return {id,events:[],rooms:new Set(),emit(event,payload){this.events.push({event,payload})},join(code){this.rooms.add(code)},leave(code){this.rooms.delete(code)}}}

test('creates private room with a six-character code and host',()=>{
 const io=fakeIo(),hub=new GameHub(io),s=fakeSocket('one');hub.create(s,'Raven');
 const created=s.events.find(e=>e.event==='created');assert.ok(created);assert.match(created.payload.code,/^[A-HJ-NP-Z2-9]{6}$/);
 const room=hub.rooms.get(created.payload.code);assert.equal(room.players.size,1);assert.equal(room.hostId,'one');assert.equal(room.phase,'lobby');
});
test('rejects missing room and duplicate nickname',()=>{
 const hub=new GameHub(fakeIo()),a=fakeSocket('a'),b=fakeSocket('b');hub.join(a,'NOPE99','Raven');assert.match(a.events.at(-1).payload.message,/not found/);
 hub.create(a,'Raven');const code=a.events.find(e=>e.event==='created').payload.code;hub.join(b,code,'rAvEn');assert.match(b.events.at(-1).payload.message,/already/);
});
test('starts a match with five rounds and secret prompt only for artist',()=>{
 const io=fakeIo(),hub=new GameHub(io),a=fakeSocket('a'),b=fakeSocket('b');hub.create(a,'Raven');const code=a.events.find(e=>e.event==='created').payload.code;hub.join(b,code,'Fox');hub.start(a);
 const room=hub.rooms.get(code);assert.equal(room.phase,'playing');assert.equal(room.round,1);assert.equal(room.deadline-room.startedAt,90000);assert.ok(room.artistId);
 const artist=room.artistId==='a'?a:b,guesser=room.artistId==='a'?b:a;assert.ok(hub.publicState(room,artist.id).prompt);assert.equal(hub.publicState(room,guesser.id).prompt,null);assert.equal(hub.publicState(room,guesser.id).category,null);hub.clearTimer(code);
});
test('normalizes guesses without case or punctuation sensitivity',()=>{
 const io=fakeIo(),hub=new GameHub(io),a=fakeSocket('a'),b=fakeSocket('b');hub.create(a,'Raven');const code=a.events.find(e=>e.event==='created').payload.code;hub.join(b,code,'Fox');hub.start(a);const room=hub.rooms.get(code);const artist=room.artistId==='a'?a:b,guesser=room.artistId==='a'?b:a;hub.guess(guesser,room.prompt.toLowerCase()+'!!!');assert.equal(room.solved.has(guesser.id),true);assert.ok(room.players.get(guesser.id).score>=10);hub.clearTimer(code);
});

test('resumes a disconnected player on a new socket without losing the room or score',()=>{
 const hub=new GameHub(fakeIo()),a=fakeSocket('a'),b=fakeSocket('b');hub.create(a,'Raven');const code=a.events.find(e=>e.event==='created').payload.code;const token=a.events.find(e=>e.event==='session-token').payload.token;hub.join(b,code,'Fox');hub.start(a);const room=hub.rooms.get(code);room.players.get('a').score=42;hub.disconnect(a);const reconnect=fakeSocket('a-new');hub.resume(reconnect,token);assert.equal(room.players.has('a'),false);assert.equal(room.players.has('a-new'),true);assert.equal(room.players.get('a-new').score,42);assert.equal(room.players.get('a-new').connected,true);assert.equal(hub.playerRooms.get('a-new'),code);hub.clearTimer(code);
});

test('draw events are accepted only from the selected artist',()=>{
 const io=fakeIo(),hub=new GameHub(io),a=fakeSocket('a'),b=fakeSocket('b');hub.create(a,'Raven');const code=a.events.find(e=>e.event==='created').payload.code;hub.join(b,code,'Fox');hub.start(a);const room=hub.rooms.get(code);const artist=room.artistId==='a'?a:b,guesser=room.artistId==='a'?b:a;hub.draw(guesser,{color:'#ffffff',width:4,points:[{x:.5,y:.5}]});assert.equal(room.drawing.length,0);hub.draw(artist,{color:'#ffffff',width:4,points:[{x:.5,y:.5}]});assert.equal(room.drawing.length,1);hub.clearTimer(code);
});
