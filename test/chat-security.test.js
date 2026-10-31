const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
const src=fs.readFileSync(require('node:path').join(__dirname,'../server.js'),'utf8');
function harness(){
  const routes={},tokens=new Map(),files=[];let chat,shipment={id:'QT-TEST',ownerAdmin:'admin2',receiver:{tel:'+234 800 123 4567'}},serial=0;
  const ctx={Buffer,JWT_SECRET:'test-secret',crypto,Date,Map,process:{env:{JWT_SECRET:'test-secret',ADMIN_USERNAME:'admin'}},
    app:{post:(p,...h)=>routes['POST '+p]=h,get:(p,...h)=>routes['GET '+p]=h,patch:(p,...h)=>routes['PATCH '+p]=h},
    jwt:{sign:claims=>{const token='signed-'+(++serial);tokens.set(token,claims);return token},verify:token=>{if(!tokens.has(token))throw Error('Invalid token');return tokens.get(token)}},
    Shipment:{findOne:async()=>shipment},
    ChatFile:{create:async file=>{files.push(file);return file},findOne:async query=>files.find(file=>Object.entries(query).every(([key,value])=>file[key]===value))},
    Chat:{findOneAndUpdate:async(filter,update)=>{
      if(!chat&&update.$setOnInsert)chat={...update.$setOnInsert,messages:[]};
      if(!chat||Object.entries(filter).some(([k,v])=>chat[k]!==v))return null;
      Object.assign(chat,update.$set);if(update.$push)chat.messages.push(update.$push.messages);return chat;
    },findOne:async filter=>chat&&Object.entries(filter).every(([k,v])=>chat[k]===v)?chat:null}
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(src.indexOf('function authRequired('),src.indexOf('//',src.indexOf('function authRequired(')+30)),ctx);
  vm.runInContext(src.slice(src.indexOf('function supportUsername')),ctx);
  async function invoke(method,path,{body={},headers={},params={},ip='client'}={}){
    const req={body,headers,params,ip};let status=200,data;
    const res={set(){return this},status(n){status=n;return this},json(value){data=value}};
    const handlers=routes[method+' '+path];
    for(let i=0;i<handlers.length;i++){let next=false;await handlers[i](req,res,()=>next=true);if(!next)break;}
    return {status,data};
  }
  return {ctx,invoke,get chat(){return chat},get shipment(){return shipment},tokens};
}
const unlock={trackingId:'qt-test',phone:'+2348001234567',userName:'Customer'};
test('unlock validates phone and recovers the same shipment conversation across devices',async()=>{
 const h=harness();let r=await h.invoke('POST','/api/chat/session',{body:{...unlock,phone:'1234567'}});assert.equal(r.status,403);assert.equal(h.chat,undefined);
 r=await h.invoke('POST','/api/chat/session',{body:unlock});assert.equal(r.status,200);const id=r.data.chat.sessionId;assert.equal(h.chat.assignedAdmin,'admin2');assert.equal(h.chat.shipmentId,'QT-TEST');
 const headers={'x-chat-token':r.data.chatToken};r=await h.invoke('POST','/api/chat/message',{headers,body:{sessionId:id,text:'Hello'}});assert.equal(r.status,200);
 r=await h.invoke('POST','/api/chat/session',{body:unlock,ip:'another-device'});assert.equal(r.data.chat.sessionId,id);assert.equal(r.data.chat.messages[0].text,'Hello');
});
test('session IDs alone and tokens for another session cannot read or write chats',async()=>{
 const h=harness();const r=await h.invoke('POST','/api/chat/session',{body:unlock});const sessionId=r.data.chat.sessionId;
 for(const [method,path,extra]of [['GET','/api/chat/session/:sessionId',{params:{sessionId}}],['POST','/api/chat/message',{body:{sessionId,text:'Forged'}}]]){
  assert.equal((await h.invoke(method,path,extra)).status,401);
  assert.equal((await h.invoke(method,path,{...extra,headers:{'x-chat-token':'bad'}})).status,401);
 }
 assert.equal((await h.invoke('GET','/api/chat/session/:sessionId',{params:{sessionId:'another'},headers:{'x-chat-token':r.data.chatToken}})).status,401);
});
test('customer tokens cannot authenticate as admins; admin chat reads enforce ownership',async()=>{
 const h=harness();const r=await h.invoke('POST','/api/chat/session',{body:unlock});const params={sessionId:r.data.chat.sessionId};
 assert.equal((await h.invoke('GET','/api/chat/session/:sessionId',{params,headers:{authorization:'Bearer '+r.data.chatToken}})).status,401);
 for(const [token,username,status] of [['first','admin',404],['second','admin2',200]]){
  h.tokens.set(token,{username});assert.equal((await h.invoke('GET','/api/chat/session/:sessionId',{params,headers:{authorization:'Bearer '+token}})).status,status);
 }
});
test('changing receiver phone revokes existing chat tokens',async()=>{
 const h=harness();const r=await h.invoke('POST','/api/chat/session',{body:unlock});h.shipment.receiver.tel='+2348009999999';
 assert.equal((await h.invoke('GET','/api/chat/session/:sessionId',{params:{sessionId:r.data.chat.sessionId},headers:{'x-chat-token':r.data.chatToken}})).status,401);
});
test('unlock attempts are limited and message images are validated',async()=>{
 const h=harness();for(let i=0;i<15;i++)assert.equal((await h.invoke('POST','/api/chat/session',{body:{...unlock,phone:'1234567'}})).status,403);
 assert.equal((await h.invoke('POST','/api/chat/session',{body:unlock})).status,429);
 assert.equal(h.ctx.validChatMessage('hello'),true);assert.equal(h.ctx.validChatMessage('x'.repeat(10001)),false);assert.equal(h.ctx.validChatMessage('', 'data:text/html;base64,WA=='),false);assert.equal(h.ctx.validChatMessage('', 'data:image/png;base64,WA=='),true);
});

test('shipment editing accepts full details for the owner and prevents ownership changes',async()=>{
 const routes={};let filter,update;
 const stored={id:'QT-TEST',ownerAdmin:'admin2',status:'Pending',sender:{tel:'1111111'},receiver:{tel:'2222222'}};
 const ctx={process:{env:{}},authRequired(){},app:Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(p,...h)=>routes[method+p]=h.at(-1)])),Shipment:{
  findOne:q=>{filter=q;const d=JSON.parse(JSON.stringify(stored));return {then:resolve=>Promise.resolve(d).then(resolve),select(){return this},lean:async()=>d}},
  findOneAndUpdate:async(q,u)=>{filter=q;update=u;return {...stored,...u.$set}}
 }};
 vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('function shipmentOwnerFilter'),src.indexOf('function genId()')),ctx);
 let data,status=200;const res={status(n){status=n;return this},json(d){data=d}};
 const body={ownerAdmin:'admin',id:'FORGED',sender:{name:'New sender'},receiver:{name:'New receiver'},package:{content:'Updated goods',expDate:'2026-11-10'},journey:[{location:'Abuja',country:'NG',type:'arrival'}],itemPhoto:null};
 await routes['patch/api/shipments/:id']({admin:{username:'admin2'},params:{id:'QT-TEST'},body},res);
 assert.equal(status,200);assert.equal(filter.ownerAdmin,'admin2');assert.equal(update.$set.ownerAdmin,undefined);assert.equal(update.$set.id,undefined);assert.equal(update.$set.receiver.name,'New receiver');assert.equal(update.$set.journey[0].location,'Abuja');assert.equal(update.$set.package.expDate,'2026-11-10');
 await routes['get/api/shipments/:id']({params:{id:'QT-TEST'}},res);assert.equal(data.receiver.tel,undefined);assert.equal(data.sender.tel,undefined);
 await routes['get/api/shipments/:id']({params:{id:'QT-TEST'},admin:{username:'admin2'}},res);assert.equal(data.receiver.tel,'2222222');
});


test('PDFs are verified by content and size and stored in protected shipment messages',async()=>{
 const h=harness();const bytes=Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF');const attachment={name:'Shipping receipt.pdf',mimeType:'application/pdf',size:bytes.length,dataUrl:'data:application/pdf;base64,'+bytes.toString('base64')};
 assert.equal(h.ctx.validChatMessage('',null,attachment),true);
 for(const invalid of [{...attachment,mimeType:'text/html'},{...attachment,size:0},{...attachment,dataUrl:'data:application/pdf;base64,'+Buffer.from('<html>Fake</html>').toString('base64')},{...attachment,name:'x'.repeat(201)}])assert.equal(h.ctx.validChatMessage('',null,invalid),false);
 assert.equal(h.ctx.validChatMessage('', 'data:image/png;base64,WA==',attachment),false);
 const tooLarge=Buffer.alloc(5*1024*1024+1,32);tooLarge.write('%PDF-');assert.equal(h.ctx.validChatMessage('',null,{...attachment,size:tooLarge.length,dataUrl:'data:application/pdf;base64,'+tooLarge.toString('base64')}),false);
 const r=await h.invoke('POST','/api/chat/session',{body:unlock}),sessionId=r.data.chat.sessionId;
 const sent=await h.invoke('POST','/api/chat/message',{headers:{'x-chat-token':r.data.chatToken},body:{sessionId,attachment}});assert.equal(sent.status,200);assert.equal(h.chat.messages[0].attachment.name,'Shipping receipt.pdf');assert.equal(h.chat.messages[0].attachment.dataUrl,undefined);
 h.tokens.set('owner',{username:'admin2'});
 const reply=await h.invoke('POST','/api/chat/reply',{headers:{authorization:'Bearer owner'},body:{sessionId,attachment:{...attachment,name:'Admin instructions.pdf'}}});assert.equal(reply.status,200);assert.equal(h.chat.messages[1].role,'admin');assert.equal(h.chat.messages[1].attachment.name,'Admin instructions.pdf');
 const params={sessionId,fileId:h.chat.messages[0].attachment.fileId};
 const download=await h.invoke('GET','/api/chat/session/:sessionId/attachment/:fileId',{params,headers:{'x-chat-token':r.data.chatToken}});assert.equal(download.status,200);assert.equal(download.data.dataUrl,attachment.dataUrl);
 assert.equal((await h.invoke('GET','/api/chat/session/:sessionId/attachment/:fileId',{params})).status,401);
 assert.equal((await h.invoke('GET','/api/chat/session/:sessionId/attachment/:fileId',{params:{...params,fileId:'other-file'},headers:{'x-chat-token':r.data.chatToken}})).status,404);
 assert.equal((await h.invoke('GET','/api/chat/session/:sessionId',{params:{sessionId}})).status,401);
});
