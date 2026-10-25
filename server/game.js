import { randomInt, randomUUID } from 'node:crypto';
import { CASES } from './words.js';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({length:6}, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
const cleanName = (s) => String(s || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0,18);
const normalize = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g,'');

export class GameHub {
  constructor(io) { this.io = io; this.rooms = new Map(); this.playerRooms = new Map(); this.timers = new Map(); this.tokens = new Map(); }
  roomFor(socket) { const code = this.playerRooms.get(socket.id); return code ? this.rooms.get(code) : null; }
  publicState(room, socketId) {
    const me = room.players.get(socketId);
    return { code:room.code, hostId:room.hostId, phase:room.phase, round:room.round, totalRounds:5,
      players:[...room.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,connected:p.connected,artist:p.id===room.artistId,solved:room.solved.has(p.id)})),
      artistId:room.artistId, deadline:room.deadline, drawing:room.drawing, category:room.phase==='playing' && socketId!==room.artistId && Date.now()-room.startedAt>=30000 ? room.hintCategory : null,
      hint:room.phase==='playing' && socketId!==room.artistId ? room.hint : null,
      wordLength:room.phase==='playing' && socketId!==room.artistId && Date.now()-room.startedAt>=60000 ? room.prompt.replace(/\s/g,'').length : null,
      prompt:socketId===room.artistId ? room.prompt : null, answer:room.phase==='results'||room.phase==='finished' ? room.prompt : null,
      guesses:room.guesses.slice(-12).map(g=>({name:g.name,text:g.text,correct:g.correct})), solvedCount:room.solved.size,
      clueFragments:room.phase==='finished' ? room.clueFragments : [], message:room.message,
      youAreArtist:socketId===room.artistId, myId:socketId, canStart:socketId===room.hostId && room.players.size>=2 && room.phase==='lobby',
      finalCase:room.phase==='finished' ? room.clueFragments.join(' ') : null };
  }
  sendState(room) { for (const p of room.players.values()) { if (p.connected) this.io.to(p.id).emit('state',this.publicState(room,p.id)); } }
  emitError(socket,msg) { socket.emit('notice',{type:'error',message:msg}); }
  create(socket,name,token) {
    name=cleanName(name); if(!name) return this.emitError(socket,'Choose a nickname first.');
    this.leave(socket); let code; do {code=makeCode();} while(this.rooms.has(code));
    const room={code,hostId:socket.id,players:new Map(),phase:'lobby',round:0,artistId:null,prompt:null,case:null,deadline:null,drawing:[],guesses:[],solved:new Set(),hint:null,hintCategory:null,clueFragments:[],message:'Waiting for your team…',lastArtistId:null,startedAt:0};
    this.rooms.set(code,room); this.addPlayer(room,socket,name,token); socket.emit('created',{code}); this.sendState(room);
  }
  join(socket,code,name,token) {
    code=String(code||'').trim().toUpperCase(); name=cleanName(name); const room=this.rooms.get(code);
    if(!name) return this.emitError(socket,'Choose a nickname first.');
    if(!room) return this.emitError(socket,'That room code was not found.');
    if(room.phase!=='lobby' && room.phase!=='playing' && room.phase!=='results') return this.emitError(socket,'That match has ended. Create a new room.');
    if(room.players.size>=4) return this.emitError(socket,'This room is full (4 players maximum).');
    if([...room.players.values()].some(p=>p.name.toLowerCase()===name.toLowerCase())) return this.emitError(socket,'That nickname is already in this room.');
    this.leave(socket); this.addPlayer(room,socket,name,token); this.sendState(room);
  }
  addPlayer(room,socket,name,token) { token=String(token||'').slice(0,100); if(!/^[a-f0-9-]{20,100}$/i.test(token)) token=randomUUID(); const p={id:socket.id,name,score:0,connected:true,token}; room.players.set(socket.id,p); this.tokens.set(token,{code:room.code,id:socket.id}); this.playerRooms.set(socket.id,room.code); socket.join(room.code); socket.emit('session-token',{token,code:room.code}); }
  resume(socket,token) { const saved=this.tokens.get(String(token||'')); if(!saved)return; const room=this.rooms.get(saved.code), oldId=saved.id, player=room?.players.get(oldId); if(!room||!player)return; const existing=this.roomFor(socket); if(existing)this.leave(socket); room.players.delete(oldId); this.playerRooms.delete(oldId); player.id=socket.id; player.connected=true; room.players.set(socket.id,player); this.playerRooms.set(socket.id,room.code); saved.id=socket.id; if(room.hostId===oldId)room.hostId=socket.id; if(room.artistId===oldId)room.artistId=socket.id; if(room.solved.delete(oldId))room.solved.add(socket.id); socket.join(room.code); socket.emit('resumed',{code:room.code}); this.sendState(room); }
  leave(socket) {
    const code=this.playerRooms.get(socket.id), room=code&&this.rooms.get(code); if(!room)return;
    this.playerRooms.delete(socket.id); const departing=room.players.get(socket.id); if(departing?.token)this.tokens.delete(departing.token); room.players.delete(socket.id); socket.leave(code);
    if(room.players.size===0){this.clearTimer(code);this.rooms.delete(code);return;}
    if(room.hostId===socket.id) room.hostId=room.players.keys().next().value;
    if(room.artistId===socket.id && room.phase==='playing') this.endRound(room,'The artist disconnected.');
    this.sendState(room);
  }
  start(socket) { const room=this.roomFor(socket); if(!room||room.hostId!==socket.id||room.players.size<2||room.phase!=='lobby') return this.emitError(socket,'The host can start when 2–4 players are in the lobby.'); room.deck=[...CASES]; room.round=0; for(const p of room.players.values())p.score=0; this.startRound(room); }
  startRound(room) {
    this.clearTimer(room.code); if(room.round>=5){room.phase='finished';room.artistId=null;room.prompt=null;room.message='Case closed. The evidence has been assembled.';this.sendState(room);return;}
    room.round++; const ids=[...room.players.keys()]; let choices=ids.filter(id=>id!==room.lastArtistId); if(!choices.length)choices=ids;
    room.artistId=choices[randomInt(choices.length)]; room.lastArtistId=room.artistId; room.case=room.deck[(room.round-1)%room.deck.length]; room.prompt=room.case.word; room.hintCategory=room.case.category; room.hint=null; room.phase='playing'; room.drawing=[]; room.guesses=[]; room.solved=new Set(); room.deadline=Date.now()+90000; room.startedAt=Date.now(); room.message='A new clue has appeared. Sketch carefully.'; this.sendState(room);
    this.timers.set(room.code,setTimeout(()=>this.endRound(room,'Time is up.'),90000));
  }
  draw(socket,stroke) { const room=this.roomFor(socket); if(!room||room.phase!=='playing'||room.artistId!==socket.id)return;
    if(!Array.isArray(stroke?.points)||stroke.points.length>160)return;
    const color=/^#[0-9a-fA-F]{6}$/.test(stroke.color)?stroke.color:'#e8edf7'; const width=Math.max(1,Math.min(18,Number(stroke.width)||4));
    const points=stroke.points.slice(0,160).map(p=>({x:Math.max(0,Math.min(1,Number(p.x)||0)),y:Math.max(0,Math.min(1,Number(p.y)||0))}));
    if(!points.length)return; const safe={color,width,points}; room.drawing.push(safe); if(room.drawing.length>2500)room.drawing=room.drawing.slice(-2000); this.io.to(room.code).emit('stroke',safe);
  }
  clearDrawing(socket) { const r=this.roomFor(socket); if(r&&r.phase==='playing'&&r.artistId===socket.id){r.drawing=[];this.io.to(r.code).emit('drawing-cleared');} }
  guess(socket,text) { const room=this.roomFor(socket), p=room?.players.get(socket.id); if(!room||!p||room.phase!=='playing'||socket.id===room.artistId||Date.now()>=room.deadline||room.solved.has(socket.id))return;
    const guess=String(text||'').trim().slice(0,60); if(!guess)return;
    const correct=normalize(guess)===normalize(room.prompt); room.guesses.push({name:p.name,text:guess,correct});
    if(correct){room.solved.add(socket.id);const elapsed=Math.floor((Date.now()-room.startedAt)/1000);p.score+=Math.max(10,100-elapsed);room.message=`${p.name} solved the clue!`;socket.emit('guess-result',{correct:true,message:'Correct! You earned '+Math.max(10,100-elapsed)+' points.'});}
    else { this.io.to(socket.id).emit('guess-result',{correct:false,message:'Not quite. Keep investigating.'}); }
    this.sendState(room); if(room.solved.size>=room.players.size-1)this.endRound(room,'Every guesser solved it!');
  }
  endRound(room,reason) { if(room.phase!=='playing')return; this.clearTimer(room.code); room.phase='results'; room.deadline=null; room.message=reason; const artist=room.players.get(room.artistId); if(artist&&room.solved.size>0)artist.score+=25; room.clueFragments.push(room.case.fragment); this.sendState(room); const transition=setTimeout(()=>{if(this.rooms.get(room.code)===room&&room.phase==='results')this.startRound(room);},6500); transition.unref?.(); }
  hintTick() { const now=Date.now(); for(const room of this.rooms.values())if(room.phase==='playing'){const elapsed=(now-room.startedAt)/1000;let changed=false;if(elapsed>=60&&room.hint!==room.prompt[0]){room.hint=room.prompt[0];changed=true;}else if(elapsed>=30&&room.hint===null){room.hint='';changed=true;}if(changed)this.sendState(room);} }
  clearTimer(code){const t=this.timers.get(code);if(t)clearTimeout(t);this.timers.delete(code);}
  disconnect(socket) { const room=this.roomFor(socket); if(room){const p=room.players.get(socket.id);if(p)p.connected=false;this.sendState(room);const grace=setTimeout(()=>{const current=this.rooms.get(room.code);if(current?.players.has(socket.id)&&!current.players.get(socket.id).connected){this.leave(socket);}},20000); grace.unref?.();} }
}
