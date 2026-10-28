const {chromium}=require('playwright');const http=require('http');const fs=require('fs');const os=require('os');const path=require('path');
const ext=path.resolve(__dirname,'..');
const html=`<!doctype html><html lang=pt><body style="margin:0;background:#fff;font:20px sans-serif">
<p id=ok style="color:#000">texto bom</p>
<p id=ruim style="color:#999">texto cinza claro</p>
<div style="display:flex"><div id=verm style="width:200px;height:100px;background:#e00"></div><div id=verd style="width:200px;height:100px;background:#0a0"></div><div id=azul style="width:200px;height:100px;background:#00e"></div></div>
<img src="x.png"><a href="#"></a></body></html>`;
const srv=http.createServer((q,r)=>{r.setHeader('content-type','text/html');r.end(html)}).listen(0);
const ok=(c,m)=>{console.log(c?'OK  ':'FAIL',m);if(!c)process.exitCode=1};
(async()=>{
const port=srv.address().port;
const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'pw-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
let sw=ctx.serviceWorkers()[0];
const page=await ctx.newPage();await page.setViewportSize({width:900,height:500});
await page.goto(`http://localhost:${port}/`);
// extensão ativa? content script cria nada até aplicar; abre popup como página
const popup=await ctx.newPage();
// descobre id da extensão pela página de extensões
await popup.goto('chrome://extensions');
const id=await popup.evaluate(async()=>{const l=await chrome.developerPrivate.getExtensionsInfo();return l.find(e=>e.name.startsWith('SimVis')).id}).catch(()=>null);
ok(!!id,'extensão carregada, id='+id);
await popup.goto(`chrome-extension://${id}/popup.html`);
// ajuda: manda mensagem do popup para a aba da página (sem permissão tabs)
const enviar=(msg)=>popup.evaluate(async(msg)=>{const tabs=await chrome.tabs.query({});for(const t of tabs){try{const r=await chrome.tabs.sendMessage(t.id,msg);if(r)return r}catch(e){}}return null},msg);
async function px(sel){const b=await page.locator(sel).boundingBox();const s=await page.screenshot({clip:{x:b.x+b.width/2,y:b.y+b.height/2,width:1,height:1}});
  const {PNG}=require('pngjs');const p=PNG.sync.read(s);return [p.data[0],p.data[1],p.data[2]]}
const base=await px('#verm');ok(base[0]>200&&base[1]<40,'sem efeito: vermelho puro '+base);
let r=await enviar({type:'APPLY_EFFECT',effect:'deuteranopia',options:{severidade:1}});ok(r&&r.ok,'content script respondeu (sem permissão tabs/scripting)');
const d1=await px('#verm');ok(d1[1]>d1[0]*0.6||d1[0]<150,'deuteranopia sev 1 mudou o vermelho '+d1);
await enviar({type:'APPLY_EFFECT',effect:'deuteranopia',options:{severidade:0}});
const d0=await px('#verm');ok(Math.abs(d0[0]-base[0])<6&&Math.abs(d0[1]-base[1])<6,'severidade 0 = visão normal '+d0);
await enviar({type:'APPLY_EFFECT',effect:'deuteranopia',options:{severidade:0.5}});
const dh=await px('#verm');ok(dh[0]<base[0]&&dh[0]>d1[0]-1,'severidade 0.5 intermediária '+dh+' entre '+base+' e '+d1);
await enviar({type:'APPLY_EFFECT',effect:'acromatopsia',options:{severidade:1}});
const g=await px('#verd');ok(Math.max(...g)-Math.min(...g)<6,'acromatopsia cinza '+g);
// verificador com baseline
r=await enviar({type:'APPLY_EFFECT',effect:'protanopia',options:{severidade:1}});
r=await enviar({type:'RUN_A11Y_CHECK'});console.log('resumo',JSON.stringify(r.resumo));
ok(r.resumo.contrasteBase!==undefined,'resumo traz contrasteBase');
ok(r.resumo.imagens===1&&r.resumo.linksBotoes===1,'imagens/links detectados');
await page.screenshot({path:require('os').tmpdir()+'/e_painel.png'});
// painel nítido em acromatopsia
await enviar({type:'APPLY_EFFECT',effect:'acromatopsia',options:{severidade:1}});await enviar({type:'RUN_A11Y_CHECK'});
await page.screenshot({path:require('os').tmpdir()+'/e_gray.png'});
// túnel
await enviar({type:'APPLY_EFFECT',effect:'visao-tunel',options:{raio:60}});
await page.mouse.move(450,250);await page.waitForTimeout(100);
const t1=await page.evaluate(()=>document.getElementById('simvisao-tunel-overlay').style.background);
ok(t1.includes('60px')&&t1.includes('450px'),'túnel raio 60 seguindo mouse');
await enviar({type:'APPLY_EFFECT',effect:'visao-tunel',options:{raio:200}});
const t2=await page.evaluate(()=>document.getElementById('simvisao-tunel-overlay').style.background);
ok(t2.includes('200px')&&t2.includes('450px'),'raio muda mantendo posição do mouse');
await enviar({type:'APPLY_EFFECT',effect:'none'});
ok(await page.evaluate(()=>!document.getElementById('simvisao-tunel-overlay')),'túnel removido');
// persistência: salva e recarrega
await popup.evaluate(()=>chrome.storage.local.set({simvisaoEffect:'protanopia',simvisaoOptions:{severidade:1}}));
await page.reload();await page.waitForTimeout(300);
ok((await page.evaluate(()=>document.documentElement.style.filter)).includes('protanopia'),'efeito restaurado após reload');
await ctx.close();srv.close();})();
