const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'traceguard-ui-'));
  const port = 8876;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.env.PYTHON || 'python', ['-m','uvicorn','app.main:create_app','--factory','--host','127.0.0.1','--port',String(port)], {
    env:{...process.env,TRACEGUARD_DB:path.join(temporary,'ui.db'),TRACEGUARD_SEED_DEMO:'true'}, stdio:['ignore','pipe','pipe']
  });
  let serverLog=''; server.stderr.on('data',chunk=>serverLog+=chunk);
  let browser;
  try {
    let ready=false;
    for(let i=0;i<100;i++) {
      try { if((await fetch(base+'/api/health')).ok) {ready=true;break;} } catch (_) {}
      if(server.exitCode !== null)throw Error(serverLog);
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert(ready,'Test API did not start: '+serverLog);
    const options={headless:true};
    if(process.env.PLAYWRIGHT_CHROMIUM_PATH)options.executablePath=process.env.PLAYWRIGHT_CHROMIUM_PATH;
    if(process.env.PLAYWRIGHT_NO_SANDBOX==='1')options.args=['--no-sandbox'];
    browser=await chromium.launch(options);
    const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);
    await page.getByRole('heading',{name:'See the signal. Follow the trace.'}).waitFor();
    assert.equal(await page.locator('.metric-number').nth(2).textContent(),'440');
    fs.mkdirSync('docs',{recursive:true});
    await page.screenshot({path:'docs/dashboard.png',fullPage:true});
    await page.getByRole('button',{name:'Review',exact:false}).first().click();
    const detail=page.locator('#detail-modal');
    await detail.locator('#triage-form').waitFor();
    await detail.getByRole('combobox',{name:'Status',exact:true}).selectOption('investigating');
    const note='Checked with owner. Literal text: <img src=x onerror=alert(1)>';
    await detail.getByLabel('Investigation note').fill(note);
    await detail.getByRole('button',{name:'Save decision'}).click();
    await detail.getByText('Open → Investigating',{exact:true}).waitFor();
    assert.equal(await detail.locator('.audit img').count(),0,'Note must be rendered as text, not HTML');
    await page.screenshot({path:'docs/investigation.png',fullPage:true});
    await detail.getByRole('button',{name:'Close investigation'}).click();
    await page.locator('[data-nav="alerts"]').click();
    await page.locator('#status-filter').selectOption('investigating');
    await page.waitForFunction(()=>document.querySelectorAll('#table-content tbody tr').length===1);
    await page.getByRole('button',{name:'Review',exact:false}).click();
    await detail.getByText(note,{exact:true}).waitFor();
    await detail.getByRole('button',{name:'Close investigation'}).click();
    await page.locator('[data-nav="events"]').click();
    await page.locator('#event-search').fill('alex.chen');
    await page.waitForFunction(()=>document.querySelector('#table-footer')?.textContent.includes('Showing') && [...document.querySelectorAll('#table-content .user-cell strong')].every(x=>x.textContent==='alex.chen'));
    assert((await page.locator('#table-content tbody tr').count())>0);
    await page.locator('#event-search').fill('no-matching-account');
    await page.getByRole('heading',{name:'No matching events.'}).waitFor();
    await page.getByRole('button',{name:'Clear filters'}).click();
    await page.getByRole('button',{name:'Import events'}).click();
    const template=await (await page.request.get(base+'/api/template')).body();
    await page.locator('#csv-file').setInputFiles({name:'events.csv',mimeType:'text/csv',buffer:template});
    await page.getByRole('button',{name:'Analyze events'}).click();
    await page.waitForFunction(()=>!document.querySelector('#import-modal').open);
    await page.getByRole('status').filter({hasText:'1 events imported'}).waitFor();
    const exported=await page.request.get(base+'/api/export?alerts_only=true');
    assert(exported.headers()['content-type'].includes('text/csv'));
    assert((await exported.text()).includes('risk,severity,status,source'));
    await page.locator('[data-nav="model"]').click();
    await page.getByRole('heading',{name:'Understand the decision.'}).waitFor();
    await page.getByText('Controlled synthetic benchmark',{exact:false}).waitFor();
    await page.screenshot({path:'docs/model.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#menu-button').click();
    await page.locator('[data-nav="overview"]').click();
    await page.getByRole('heading',{name:'See the signal. Follow the trace.'}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No viewport overflow on mobile');
    assert.equal(await page.locator('.metric-number').nth(2).textContent(),'441');
    await page.waitForFunction(()=>!document.querySelector('#sidebar').classList.contains('open'));
    await page.waitForFunction(()=>!document.querySelector('#toast').classList.contains('show'));
    await page.screenshot({path:'docs/mobile.png',fullPage:true,animations:'disabled'});
    assert.deepEqual(errors,[],'Browser JavaScript errors');
    console.log('PASS: dashboard, investigation + note safety, filters, empty states, CSV import/export, model view, and mobile layout.');
  } finally {
    if(browser)await browser.close();
    server.kill();
    await new Promise(resolve=>server.once('exit',resolve));
    fs.rmSync(temporary,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
