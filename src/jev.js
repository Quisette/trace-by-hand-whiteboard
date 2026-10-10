/* Jev (local) — a System One engine that speaks TypeSafe's real wire format.
 *
 * TypeSafe's Jev answers *typed questions* about a piece of content (its "state") instead of writing
 * text: a Noul (yes/no probability), a Choice (pick a label) or a Score (a rating on an ordered
 * rubric), all in one call. The public API is
 *
 *   POST /v1/systemone   {state, model, questions: {name: {type, instructions?, criteria}}}
 *                     -> {model, answers: {name: answer}, usage: {input_tokens, output_tokens}}
 *   GET  /v1/models   -> {models: [{name, description, release_date}]}
 *
 * (see docs/jev-api.md for the survey this file is built from). This file implements that contract
 * with a small local matcher instead of the hosted model, so the whiteboard works offline and any Jev
 * client (the official typesafe-sdk, src/jev-client.js, curl) can talk to it through tools/jev-server.js.
 *
 *   Jev.systemOne(body)  validated request body -> response body; throws JevRequestError (status, body)
 *   Jev.validate(body)   -> pydantic-style error list ([] when the request is valid)
 *   Jev.handle(req)      {method, path, headers, body} -> {status, headers, body}: the whole HTTP surface
 *
 * How the local matcher reads a question: `criteria` descriptions are treated as example phrases — a
 * description may be a string, an array of strings, or an object whose strings are all used (the
 * documented {"meaning": ..., "examples": [...]} form works) — and the label itself counts as an example
 * ("a choice without a description is interpreted by its name alone"). `instructions` are not used
 * (the hosted model reads them; this matcher cannot). The state's text and each example are turned into
 * token / token-bigram / character-trigram features; how much of an example is present in the state,
 * blended with trigram overlap, is its score, and label scores go through a softmax. No network, no weights.
 */
var Jev=(function(){
  var MODEL='jev-local-1', RELEASE='2026-10-10', ALIAS='jev-latest', TEMP=0.07, NOUL_BASE=0.3;
  var MODELS=[
    {name:ALIAS,description:'Alias for the newest local model ('+MODEL+').',release_date:RELEASE},
    {name:MODEL,description:'Local exemplar-matching System One model: answers noul, choice and score questions offline, matching the state against the examples in each question\'s criteria.',release_date:RELEASE}
  ];
  var CJK=/[぀-ヿ㐀-鿿가-힯]/;

  /* ---------- 文字 → 特徵 ---------- */
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
    var t=toks(s), f={}, g={}, i;
    for(i=0;i<t.length;i++){f['u:'+t[i]]=1; if(i) f['b:'+t[i-1]+' '+t[i]]=1;}
    var c=' '+t.join(' ')+' ';
    for(i=0;i+3<=c.length;i++) g[c.substr(i,3)]=(g[c.substr(i,3)]||0)+1;
    return {f:f,g:g,size:Object.keys(f).length,nu:t.length};
  }
  var cache={};
  function hf(h){return cache[h]||(cache[h]=feats(h));}
  function cos(a,b){var d=0,na=0,nb=0,k;for(k in a){na+=a[k]*a[k];if(b[k])d+=a[k]*b[k];}for(k in b)nb+=b[k]*b[k];return na&&nb?d/Math.sqrt(na*nb):0;}
  function sim(S,H){ // 0..1
    if(!H.size) return 0;
    var hit=0,uhit=0,wsum=0,k;
    for(k in H.f){var w=k[0]==='b'?1.4:1; wsum+=w; if(S.f[k]){hit+=w; if(k[0]==='u') uhit++;}}
    var recall=hit/wsum;                                                   // 範例有多少出現在狀態裡
    var su=0; for(k in S.f) if(k[0]==='u') su++;
    var prec=su?Math.min(1,uhit/su):0;                                     // 狀態有多少被範例解釋
    return 0.62*recall+0.18*prec+0.20*cos(S.g,H.g);
  }
  function best(S,hints){var b=0;(hints||[]).forEach(function(h){var v=sim(S,hf(h));if(v>b)b=v;});return b;}
  function softmax(xs){var m=Math.max.apply(null,xs),e=xs.map(function(x){return Math.exp((x-m)/TEMP);}),z=e.reduce(function(a,b){return a+b;},0);return e.map(function(x){return x/z;});}
  function entropyConf(ps){if(ps.length<2)return 1;var h=0;ps.forEach(function(p){if(p>0)h-=p*Math.log(p);});return Math.max(0,1-h/Math.log(ps.length));}
  function r4(x){return Math.round(x*10000)/10000;}

  /* 一段 criteria 描述（字串、陣列、物件）裡所有的句子 */
  function texts(v,out){
    out=out||[];
    if(v==null) return out;
    if(typeof v==='string'){if(v.trim()) out.push(v);}
    else if(typeof v==='number'||typeof v==='boolean') out.push(String(v));
    else if(Array.isArray(v)) v.forEach(function(x){texts(x,out);});
    else if(typeof v==='object') Object.keys(v).forEach(function(k){texts(v[k],out);});
    return out;
  }
  function stateText(state){return typeof state==='string'?state:texts(state).join(' ');}

  /* ---------- 三種答案 ---------- */
  function answerNoul(S,q){
    var c=q.criteria||{}, yes=texts(c.true), no=texts(c.false);
    if(!yes.length&&!no.length) return {type:'noul',noul:0.5};              // 只有 instructions：這個比對器看不懂，誠實地說「不確定」
    var y=yes.length?best(S,yes):NOUL_BASE, n=no.length?best(S,no):NOUL_BASE;   // 只描述了一邊：另一邊用「有一點像」的基準線比
    return {type:'noul',noul:r4(1/(1+Math.exp(-(y-n)/TEMP*0.6)))};
  }
  function answerChoice(S,q){
    var labels=Object.keys(q.criteria);
    var ps=softmax(labels.map(function(l){return best(S,texts(q.criteria[l]).concat([l]));})), probs={}, bi=0;
    labels.forEach(function(l,i){probs[l]=r4(ps[i]); if(ps[i]>ps[bi]) bi=i;});
    var sorted=ps.slice().sort(function(a,b){return b-a;});
    return {type:'choice',choice:labels[bi],confidence:r4(0.5*entropyConf(ps)+0.5*(sorted[0]-(sorted[1]||0))),probabilities:probs};
  }
  function answerScore(S,q){
    var lv=q.criteria, ps=softmax(lv.map(function(d){return best(S,texts(d));})), probs={}, legend={}, score=0;
    lv.forEach(function(d,i){probs[String(i)]=r4(ps[i]); legend[String(i)]=d; score+=i*ps[i];});
    return {type:'score',score:r4(score),confidence:r4(entropyConf(ps)),legend:legend,probabilities:probs};
  }

  /* ---------- 驗證：錯誤的格式跟 API 的 422 一樣（pydantic / FastAPI 風格）---------- */
  function isObj(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
  function err(type,loc,msg,input,ctx){var e={type:type,loc:loc,msg:msg}; if(input!==undefined) e.input=input; if(ctx) e.ctx=ctx; return e;}
  function content(errs,loc,v,nullable){ // str | object | array（| null）
    if(v==null&&nullable) return true;
    if(typeof v==='string'||isObj(v)||Array.isArray(v)) return true;
    errs.push(err('string_type',loc.concat('str'),'Input should be a valid string',v),
              err('dict_type',loc.concat('dict[str,any]'),'Input should be a valid dictionary',v),
              err('list_type',loc.concat('list[any]'),'Input should be a valid list',v));
    return false;
  }
  function validateQuestion(errs,name,q){
    var base=['body','questions',name];
    if(!isObj(q)){errs.push(err('model_attributes_type',base,'Input should be a valid dictionary or object to extract fields from',q)); return;}
    if(!('type' in q)){errs.push(err('union_tag_not_found',base,"Unable to extract tag using discriminator 'type'",q,{discriminator:"'type'"})); return;}
    var tag=q.type;
    if(tag!=='noul'&&tag!=='choice'&&tag!=='score'){
      errs.push(err('union_tag_invalid',base,"Input tag '"+tag+"' found using 'type' does not match any of the expected tags: 'noul', 'choice', 'score'",q,{discriminator:"'type'",tag:String(tag),expected_tags:"'noul', 'choice', 'score'"})); return;}
    var loc=base.concat(tag);
    if('instructions' in q) content(errs,loc.concat('instructions'),q.instructions,true);
    var c=q.criteria;
    if(tag==='noul'){
      if(c!=null&&!isObj(c)) {errs.push(err('model_type',loc.concat('criteria'),'Input should be a valid dictionary or instance of NoulCriteria',c)); return;}
      var described=false;
      ['true','false'].forEach(function(k){ if(c&&k in c){content(errs,loc.concat('criteria',k),c[k],true); if(c[k]!=null) described=true;} });
      if(q.instructions==null&&!described&&!errs.length) errs.push(err('value_error',loc,'Value error, a noul question needs instructions or a described outcome in criteria',q));
    } else if(tag==='choice'){
      if(!('criteria' in q)) errs.push(err('missing',loc.concat('criteria'),'Field required',q));
      else if(!isObj(c)) errs.push(err('dict_type',loc.concat('criteria'),'Input should be a valid dictionary',c));
      else if(!Object.keys(c).length) errs.push(err('value_error',loc.concat('criteria'),'Value error, a choice question needs at least one choice in criteria',c));
      else Object.keys(c).forEach(function(k){content(errs,loc.concat('criteria',k),c[k],true);});
    } else {
      if(!('criteria' in q)) errs.push(err('missing',loc.concat('criteria'),'Field required',q));
      else if(!Array.isArray(c)) errs.push(err('list_type',loc.concat('criteria'),'Input should be a valid list',c));
      else if(!c.length) errs.push(err('too_short',loc.concat('criteria'),'List should have at least 1 item after validation, not 0',c,{field_type:'List',min_length:1,actual_length:0}));
      else c.forEach(function(d,i){content(errs,loc.concat('criteria',i),d,false);});
    }
  }
  function validate(body){
    var errs=[];
    if(!isObj(body)) return [err('model_attributes_type',['body'],'Input should be a valid dictionary or object to extract fields from',body)];
    if(!('state' in body)) errs.push(err('missing',['body','state'],'Field required',body)); else content(errs,['body','state'],body.state,false);
    if(!('model' in body)) errs.push(err('missing',['body','model'],'Field required',body));
    else if(typeof body.model!=='string') errs.push(err('string_type',['body','model'],'Input should be a valid string',body.model));
    if(!('questions' in body)) errs.push(err('missing',['body','questions'],'Field required',body));
    else if(!isObj(body.questions)) errs.push(err('dict_type',['body','questions'],'Input should be a valid dictionary',body.questions));
    else if(!Object.keys(body.questions).length) errs.push(err('too_short',['body','questions'],'Dictionary should have at least 1 item after validation, not 0',body.questions,{field_type:'Dictionary',min_length:1,actual_length:0}));
    else Object.keys(body.questions).forEach(function(n){validateQuestion(errs,n,body.questions[n]);});
    return errs;
  }

  /* ---------- System One ---------- */
  function JevRequestError(status,body){var e=new Error(typeof body.detail==='string'?body.detail:'Request failed ('+status+')'); e.name='JevRequestError'; e.status=status; e.body=body; return e;}
  function resolveModel(name){for(var i=0;i<MODELS.length;i++) if(MODELS[i].name===name) return MODEL; return null;}
  function systemOne(body){
    var errs=validate(body);
    if(errs.length) throw JevRequestError(422,{detail:errs});
    var m=resolveModel(body.model);
    if(!m) throw JevRequestError(404,{detail:"Model '"+body.model+"' was not found. Available models: "+MODELS.map(function(x){return x.name;}).join(', ')+'.'});
    var S=feats(stateText(body.state)), answers={}, names=Object.keys(body.questions);
    names.forEach(function(n){
      var q=body.questions[n];
      answers[n]=q.type==='noul'?answerNoul(S,q):q.type==='choice'?answerChoice(S,q):answerScore(S,q);
    });
    return {model:m,answers:answers,usage:{input_tokens:Math.ceil(JSON.stringify({state:body.state,questions:body.questions}).length/4),output_tokens:names.length}}; // 粗估：約 4 個字元一個 token
  }

  /* ---------- HTTP ---------- */
  var reqN=0;
  function requestId(){reqN++; return 'req_local_'+Date.now().toString(36)+reqN.toString(36);}
  var CORS={'access-control-allow-origin':'*','access-control-expose-headers':'x-typesafe-request-id, retry-after, retry-after-ms'};
  /* req: {method, path, headers, body}；body 可以是字串、Uint8Array 或已經解好的物件。opts.apiKeys：有給的話要帶 Bearer key */
  function handle(req,opts){
    opts=opts||{};
    var method=String(req.method||'GET').toUpperCase(), path=String(req.path||req.url||'/').split('?')[0].replace(/\/+$/,'')||'/';
    var headers={}; Object.keys(req.headers||{}).forEach(function(k){headers[k.toLowerCase()]=req.headers[k];});
    var out={'content-type':'application/json','x-typesafe-request-id':requestId()}; Object.keys(CORS).forEach(function(k){out[k]=CORS[k];});
    function reply(status,body,extra){var h=Object.assign({},out,extra||{}); return {status:status,headers:h,body:body};}
    if(method==='OPTIONS'){
      return reply(204,null,{'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'authorization, content-type, accept, x-typesafe-sdk, x-typesafe-runtime, x-typesafe-retry-count','access-control-max-age':'600'});
    }
    var route=path==='/v1/systemone'?'POST':path==='/v1/models'?'GET':null;
    if(!route) return reply(404,{detail:'Not Found'});
    if(opts.apiKeys){
      var m=/^Bearer\s+(\S+)$/i.exec(headers.authorization||'');
      if(!m||opts.apiKeys.indexOf(m[1])<0) return reply(401,{detail:'Invalid or missing API key.'},{'www-authenticate':'Bearer'});
    }
    if(method!==route) return reply(405,{detail:'Method Not Allowed'},{allow:route});
    if(route==='GET') return reply(200,{models:MODELS});
    var body=req.body;
    if(body instanceof Uint8Array&&typeof Buffer==='undefined') body=new TextDecoder().decode(body);
    if(typeof Buffer!=='undefined'&&Buffer.isBuffer(body)) body=body.toString('utf8');
    if(typeof body==='string'){
      try{body=JSON.parse(body);}
      catch(e){return reply(422,{detail:[err('json_invalid',['body',0],'JSON decode error',{},{error:String(e.message)})]});}
    }
    try{return reply(200,systemOne(body));}
    catch(e){if(e.name==='JevRequestError') return reply(e.status,e.body); throw e;}
  }

  return {systemOne:systemOne,validate:validate,handle:handle,MODELS:MODELS,MODEL:MODEL,ALIAS:ALIAS,
    tokens:toks,similarity:function(a,b){return sim(feats(a),feats(b));},isCJK:function(c){return CJK.test(c);}};
})();
if(typeof module!=='undefined'&&module.exports) module.exports=Jev;
