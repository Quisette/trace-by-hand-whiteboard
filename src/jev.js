/* Jev (local) — a small System One decider that runs in the browser.
 *
 * TypeSafe's Jev answers *typed questions* about a given state instead of
 * generating text: a Choice (pick one option, with a probability for each),
 * a Noul (yes / no probability) or a Score (a value on a range). Every
 * question is answered in one pass over the same state and there is no
 * free-text output. This file is a local stand-in with the same contract:
 *
 *   Jev.ask({state: 'move PTR to NUM', questions: [
 *     {id: 'intent', kind: 'choice', options: [{id: 'assign', hints: ['move PTR to NUM']}, ...]},
 *     {id: 'neg',    kind: 'noul',   yes: ['not', '不'], no: ['is', '在']},
 *     {id: 'size',   kind: 'score',  range: [0, 10], anchors: [{at: 0, hints: ['empty']}, ...]}
 *   ]})
 *   -> {answers: {intent: {choice: 'assign', probs: {...}, confidence: .93}, neg: {p: .08, value: false, confidence: .84}, ...}}
 *
 * The "model" is an exemplar matcher: the state and each hint are turned into
 * token / token-bigram / character-trigram features, a hint's similarity is a
 * blend of how much of it is present in the state and of their trigram
 * overlap, and option logits go through a softmax. No network, no weights file.
 */
var Jev=(function(){
  var CJK=/[぀-ヿ㐀-鿿가-힯]/;
  function half(s){ // 全形 → 半形
    return String(s).replace(/[！-～]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0xfee0);}).replace(/　/g,' ');
  }
  function toks(s){ // 大寫標記（NUM、PTR…）保留，其他轉小寫；中日韓文字一字一個
    var out=[], re=/[A-Z][A-Z_]+|[a-z0-9_']+|[぀-ヿ㐀-鿿가-힯]|->|=>|==|!=|\+\+|--|\+=|-=|[^\s\w]/g, m;
    s=half(s).replace(/[A-Za-z0-9_']+/g,function(w){return /^[A-Z][A-Z_]+$/.test(w)?w:w.toLowerCase();});
    while((m=re.exec(s))) out.push(m[0]);
    return out;
  }
  function feats(s){
    var t=toks(s), f={}, g={}, n=0, i;
    for(i=0;i<t.length;i++){f['u:'+t[i]]=1; if(i) f['b:'+t[i-1]+' '+t[i]]=1;}
    var c=' '+t.join(' ')+' ';
    for(i=0;i+3<=c.length;i++){g[c.substr(i,3)]=(g[c.substr(i,3)]||0)+1;n++;}
    return {t:t,f:f,g:g,size:Object.keys(f).length};
  }
  var cache={};
  function hf(h){return cache[h]||(cache[h]=feats(h));}
  function cos(a,b){var d=0,na=0,nb=0,k;for(k in a){na+=a[k]*a[k];if(b[k])d+=a[k]*b[k];}for(k in b)nb+=b[k]*b[k];return na&&nb?d/Math.sqrt(na*nb):0;}
  function sim(S,H){ // 0..1
    if(!H.size) return 0;
    var hit=0,uh=0,uhit=0,k;
    for(k in H.f){ if(S.f[k]) hit+=k[0]==='b'?1.4:1; if(k[0]==='u'){uh++; if(S.f[k]) uhit++;} }
    var wsum=0; for(k in H.f) wsum+=k[0]==='b'?1.4:1;
    var recall=hit/wsum;                                  // 提示有多少出現在狀態裡
    var prec=S.size?Math.min(1,uhit/Math.max(1,Object.keys(S.f).filter(function(x){return x[0]==='u';}).length)):0; // 狀態有多少被提示解釋
    return 0.62*recall+0.18*prec+0.20*cos(S.g,H.g);
  }
  function best(S,hints){var b=0;(hints||[]).forEach(function(h){var v=sim(S,hf(h));if(v>b)b=v;});return b;}
  function softmax(xs,T){var m=Math.max.apply(null,xs),e=xs.map(function(x){return Math.exp((x-m)/T);}),z=e.reduce(function(a,b){return a+b;},0);return e.map(function(x){return x/z;});}
  function entropyConf(ps){if(ps.length<2)return 1;var h=0;ps.forEach(function(p){if(p>0)h-=p*Math.log(p);});return Math.max(0,1-h/Math.log(ps.length));}

  function answer(S,q){
    var T=q.temperature||0.07;
    if(q.kind==='choice'){
      var opts=q.options||[];
      if(!opts.length) return {id:q.id,kind:'choice',choice:null,probs:{},confidence:0};
      var logits=opts.map(function(o){return best(o.state?feats(o.state):S,o.hints)+(o.prior||0);});
      var ps=softmax(logits,T), probs={}, bi=0;
      opts.forEach(function(o,i){probs[o.id]=+ps[i].toFixed(4); if(ps[i]>ps[bi]) bi=i;});
      var sorted=ps.slice().sort(function(a,b){return b-a;});
      return {id:q.id,kind:'choice',choice:opts[bi].id,probs:probs,confidence:+(0.5*entropyConf(ps)+0.5*(sorted[0]-(sorted[1]||0))).toFixed(3)};
    }
    if(q.kind==='noul'){
      var y=best(S,q.yes)+(q.prior||0), n=best(S,q.no);
      var p=1/(1+Math.exp(-(y-n)/T*0.6));
      return {id:q.id,kind:'noul',p:+p.toFixed(4),value:p>0.5,confidence:+Math.abs(2*p-1).toFixed(3)};
    }
    if(q.kind==='score'){
      var an=q.anchors||[], w=softmax(an.map(function(a){return best(S,a.hints);}),T), v=0;
      an.forEach(function(a,i){v+=a.at*w[i];});
      var lo=(q.range||[0,1])[0], hi=(q.range||[0,1])[1];
      return {id:q.id,kind:'score',score:+Math.min(hi,Math.max(lo,v)).toFixed(3),confidence:+entropyConf(w).toFixed(3)};
    }
    throw new Error('Jev: unknown question kind '+q.kind);
  }
  /* 一次問完：同一個狀態只算一次特徵 */
  function ask(req){
    var S=feats(req.state||''), out={};
    (req.questions||[]).forEach(function(q){out[q.id]=answer(S,q);});
    return {model:'jev-local-1',answers:out};
  }
  return {ask:ask,tokens:toks,similarity:function(a,b){return sim(feats(a),feats(b));},isCJK:function(c){return CJK.test(c);}};
})();
if(typeof module!=='undefined'&&module.exports) module.exports=Jev;
