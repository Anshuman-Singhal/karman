"""Reveal-fit check: no answer reveal may push "Next leg" off the card or the screen.

For every question in the bank, at phone, tablet and desktop sizes, in metric and
imperial, it fills the reveal with that question's longest possible text (the
question, the first-week sentence, the hindsight line, the fun fact) and checks
that the Next leg button is fully on screen and inside the card.

    cd web && python3 -m http.server 8765 &      # serve the game
    python3 tools/reveal-fit.py                  # needs: pip install playwright

Exit code 1 if any question overflows anywhere.
"""
import sys
from playwright.sync_api import sync_playwright
BASE=sys.argv[1] if len(sys.argv)>1 else 'http://localhost:8765/'
VP=[(320,568),(375,667),(390,664),(390,844),(768,1024),(1024,600),(1280,600),(1280,720),(1440,800)]
JS=r"""(units)=>{
 const out=[];const dock=document.getElementById('dock');
 const q=document.querySelector('#screen-round .question');
 const line=document.querySelector('.result-line'),hind=document.querySelector('.result-hind'),fact=document.querySelector('.result-fact');
 const vd=document.querySelector('.verdict-delta');
 const nb=document.getElementById('btn-next');
 for(const f of K.FACTS){
   const v=K.units.view(f);
   q.textContent=f.q;
   const ans=`<strong>${v.fmt(f.answer,true)} ${v.unit}</strong>`;
   const lo=f.scale==='year'?f.answer-5:f.answer*0.62, hi=f.scale==='year'?f.answer+5:f.answer*0.81;
   line.innerHTML=`The answer, ${ans}, wasn't between ${v.fmt(lo)} and ${v.fmt(hi)}${v.unit?' '+v.unit:''}, so no climb.`;
   // the widest result head: the longest verdict, a clued climb and the photo-finish words
   document.querySelector('.verdict').textContent='Pinpoint';
   vd.innerHTML='+12.5 km (clue: half) <em class="vd-hair">by a hair</em>';
   hind.hidden=false;hind.innerHTML=`<i></i><b>rough idea</b> <span class="hind-range">(${v.fmt(lo)}–${v.fmt(hi*1.5)})</span> would've caught it.`;
   fact.textContent=K.units.hint(f.card);
   const b=nb.getBoundingClientRect(),d=dock.getBoundingClientRect();
   const over=Math.round(b.bottom-Math.min(d.bottom,innerHeight));
   if(over>0||d.top<0) out.push([f.id,over,Math.round(d.top),f.q.length,f.card.length]);
 }
 return out;}"""
bad=0
with sync_playwright() as p:
    b=p.chromium.launch()
    for units in ('metric','imperial'):
     for (w,h) in VP:
         pg=b.new_page(viewport={'width':w,'height':h})
         pg.goto(BASE);pg.wait_for_timeout(1200)
         pg.evaluate(f"()=>{{const d=K.storage.data;d.tutored=true;d.guideV=99;d.stats={{...(d.stats||{{}}),flights:0}};d.prefs={{...(d.prefs||{{}}),units:'{units}'}};K.storage.save();}}")
         pg.reload();pg.wait_for_timeout(1200)
         pg.evaluate("K.game.boot({mode:'unlimited',fresh:true})");pg.wait_for_timeout(400)
         pg.evaluate("K.game.launch()");pg.wait_for_timeout(5000)
         pg.keyboard.type('3');pg.wait_for_timeout(200)
         pg.locator('.wbtn:visible').nth(4).click();pg.wait_for_timeout(200)
         pg.evaluate("K.game.lock()");pg.wait_for_timeout(4500)
         res=pg.evaluate(JS,units)
         worst=sorted(res,key=lambda r:-r[1])[:4]
         bad+=len(res); print(f'{w}x{h} {units}: {len(res)} of {pg.evaluate("K.FACTS.length")} overflow', worst)
         pg.close()
    b.close()
sys.exit(1 if bad else 0)
