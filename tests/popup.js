const {chromium}=require('playwright');
(async()=>{
const b=await chromium.launch();const p=await b.newPage({viewport:{width:300,height:760}});
await p.addInitScript(()=>{window.__sent=[];const st={simvisaoEffect:'deuteranopia',simvisaoOptions:{severidade:0.6}};
window.chrome={tabs:{query:async()=>[{id:1}],sendMessage:async(id,m)=>{window.__sent.push(m);return {ok:true,resumo:{contraste:12,contrasteBase:0,imagens:0,linksBotoes:0,campos:0}}}},
storage:{local:{get:(k,cb)=>cb(st),set:async(o)=>Object.assign(st,o)}}}});
await p.goto('file://'+require('path').join(__dirname,'..','popup.html'));
await p.waitForTimeout(200);
const v=await p.inputValue('#ajuste-severidade');console.log('slider restaurado:',v);
await p.fill('#ajuste-severidade','30');await p.dispatchEvent('#ajuste-severidade','input');
await p.click('button[data-effect="visao-tunel"]');await p.waitForTimeout(100);
await p.click('#verificar-a11y');await p.waitForTimeout(100);
console.log(JSON.stringify(await p.evaluate(()=>window.__sent)));
console.log('visiveis:',await p.evaluate(()=>[...document.querySelectorAll('[data-ajuste]')].filter(e=>!e.classList.contains('oculto')).map(e=>e.dataset.ajuste)));
console.log(await p.textContent('#resumo-a11y'));
await p.screenshot({path:require('os').tmpdir()+'/popup.png'});
await p.click('button[data-effect="baixa-visao"]');await p.screenshot({path:require('os').tmpdir()+'/popup2.png'});
await b.close();})();
