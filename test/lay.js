const crypto=require('crypto');const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/data/tvbox.db');const sid=crypto.randomBytes(16).toString('hex');
const u=db.prepare('SELECT id FROM users WHERE is_admin=1 LIMIT 1').get();
db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(crypto.createHash('sha256').update(sid).digest('hex'),u.id,Date.now()+3600e3);
const {chromium}=require('/app/sniffer/node_modules/playwright-core');const S=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--no-zygote']});
for(const [w,h,m] of [[1600,950,0],[390,844,1]]){const ctx=await b.newContext({viewport:{width:w,height:h},isMobile:!!m,hasTouch:!!m,deviceScaleFactor:m?2:1});await ctx.addCookies([{name:'tvb_sid',value:sid,domain:'127.0.0.1',path:'/'}]);const p=await ctx.newPage();
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://127.0.0.1:8686/#/detail?auto=1&repo=1&name='+encodeURIComponent(process.env.NAME||'庆余年 第二季'));await S(30000);
await p.screenshot({path:'/data/l'+w+'a.png'});await p.click('#bSwitch');await S(1500);await p.screenshot({path:'/data/l'+w+'b.png',fullPage:!!m});await ctx.close();}
await b.close();process.exit(0)})();
