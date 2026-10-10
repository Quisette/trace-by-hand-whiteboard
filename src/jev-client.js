/* JevClient — a small client for the System One API: TypeSafe's hosted Jev (https://api.typesafe.ai) or any
 * compatible server such as tools/jev-server.js. It follows the behaviour of the official typesafe-sdk
 * (Python, v0.7.x): Bearer auth, POST /v1/systemone + GET /v1/models, the same client-side question checks,
 * typed errors by HTTP status, retries on 408 / 429 / 5xx / network errors with exponential backoff that
 * honours Retry-After, and answers grouped into .nouls / .choices / .scores.
 *
 *   const client = new JevClient({apiKey: process.env.TYPESAFE_API_KEY});           // or baseUrl: 'http://127.0.0.1:8787'
 *   const r = await client.systemOne({
 *     state: 'I was charged twice. Please help.',
 *     questions: {
 *       billing: JevClient.noul('Is this about billing?'),
 *       tone: JevClient.choice({calm: null, angry: null}, 'What is the tone?'),
 *       urgency: JevClient.score(['can wait', 'this week', 'today'], 'How urgent is this?')}});
 *   r.nouls.billing.noul, r.choices.tone.choice, r.scores.urgency.score
 *
 * Works in Node 18+ and browsers (global fetch). Browsers must be allowed by the server's CORS policy.
 */
var JevClient=(function(){
  var DEFAULT_BASE_URL='https://api.typesafe.ai', DEFAULT_MODEL='jev-latest', SYSTEM_ONE_PATH='/v1/systemone', MODELS_PATH='/v1/models';
  var ENV=(typeof process!=='undefined'&&process.env)?process.env:{};

  /* ---------- 錯誤 ---------- */
  class JevError extends Error{constructor(msg){super(msg); this.name=this.constructor.name;}}
  function extractMessage(body){
    if(typeof body==='string') return body||null;
    if(!body||typeof body!=='object'||Array.isArray(body)) return null;
    var e=body.error, m=body.message, d=body.detail;
    if(typeof e==='string') return e;
    if(e&&typeof e==='object'&&typeof e.message==='string') return e.message;
    if(typeof m==='string') return m;
    if(typeof d==='string') return d;
    if(d&&typeof d==='object'&&!Array.isArray(d)&&typeof d.message==='string') return d.message;
    if(Array.isArray(d)){
      var parts=d.filter(function(x){return x&&typeof x.msg==='string';}).map(function(x){
        var path=Array.isArray(x.loc)?x.loc.filter(function(p){return p!=='body';}).join('.'):'';
        return path?path+': '+x.msg:x.msg;});
      return parts.join('; ')||null;
    }
    return null;
  }
  function parseRetryAfter(h){ // → 毫秒或 null
    var ms=h['retry-after-ms'], s=h['retry-after'], v;
    if(ms!=null){v=parseFloat(ms); if(isFinite(v)&&v>=0) return v;}
    if(s!=null){
      v=parseFloat(s); if(isFinite(v)&&v>=0&&/^\s*[\d.]+\s*$/.test(s)) return v*1000;
      var t=Date.parse(s); if(!isNaN(t)) return Math.max(0,t-Date.now());
    }
    return null;
  }
  class JevAPIError extends JevError{
    constructor(status,body,headers,endpoint,message){
      var detail=message||extractMessage(body)||(body==null?'status code (no body)':(typeof body==='string'?body:JSON.stringify(body)).slice(0,200));
      var rid=headers&&headers['x-typesafe-request-id'];
      super((endpoint?endpoint+': ':'')+status+' '+detail+(rid?' (request_id='+rid+')':''));
      this.status=status; this.body=body; this.headers=headers||{}; this.endpoint=endpoint||null; this.detail=detail;
    }
    get requestId(){return this.headers['x-typesafe-request-id']||null;}
    get retryAfterMs(){return parseRetryAfter(this.headers);}
  }
  class JevBadRequestError extends JevAPIError{}
  class JevAuthenticationError extends JevAPIError{}
  class JevPermissionDeniedError extends JevAPIError{}
  class JevNotFoundError extends JevAPIError{}
  class JevUnprocessableEntityError extends JevAPIError{}
  class JevRateLimitError extends JevAPIError{}
  class JevInternalServerError extends JevAPIError{}
  class JevResponseValidationError extends JevAPIError{
    constructor(status,body,headers,fieldPath,endpoint){super(status,body,headers,endpoint,'Invalid response data at '+JSON.stringify(fieldPath)+'.'); this.fieldPath=fieldPath;}
  }
  class JevConnectionError extends JevError{}
  class JevTimeoutError extends JevConnectionError{}
  var STATUS_ERRORS={400:JevBadRequestError,401:JevAuthenticationError,403:JevPermissionDeniedError,404:JevNotFoundError,422:JevUnprocessableEntityError,429:JevRateLimitError};
  function apiError(status,body,headers,endpoint){
    var C=STATUS_ERRORS[status]||(status>=500?JevInternalServerError:JevAPIError);
    return new C(status,body,headers,endpoint);
  }

  /* ---------- 問題：跟官方 SDK 一樣先在本地檢查 ---------- */
  function noul(instructions,criteria){var q={type:'noul'}; if(instructions!=null) q.instructions=instructions; if(criteria!=null) q.criteria=criteria; return q;}
  function choice(criteria,instructions){var q={type:'choice',criteria:criteria}; if(instructions!=null) q.instructions=instructions; return q;}
  function score(criteria,instructions){var q={type:'score',criteria:criteria}; if(instructions!=null) q.instructions=instructions; return q;}
  function isObj(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
  function normalizeQuestions(questions){
    if(!isObj(questions)||!Object.keys(questions).length) throw new JevError('At least one question is required.');
    Object.keys(questions).forEach(function(n){
      var q=questions[n];
      if(!isObj(q)||typeof q.type!=='string'||!q.type) throw new JevError('Question "'+n+'" must be an object with a nonempty string "type".');
      if((q.type==='choice'||q.type==='score')&&!('criteria' in q)) throw new JevError('Question "'+n+'" requires "criteria".');
      if(q.type==='score'&&(!Array.isArray(q.criteria)||!q.criteria.length)) throw new JevError('Score question "'+n+'" has no criteria; at least one score is required.');
      if(q.type==='choice'&&(!isObj(q.criteria)||!Object.keys(q.criteria).length)) throw new JevError('Choice question "'+n+'" has no criteria; at least one choice is required.');
      if(q.type==='noul'){
        if(q.criteria!=null&&!isObj(q.criteria)) throw new JevError('Noul question "'+n+'" criteria must be an object.');
        var described=isObj(q.criteria)&&Object.keys(q.criteria).some(function(k){return q.criteria[k]!=null;});
        if(q.instructions==null&&!described) throw new JevError('Noul question "'+n+'" has neither instructions nor criteria; at least one is required.');
      }
    });
    return questions;
  }

  /* ---------- 回應 ---------- */
  var ANSWER_TYPES={noul:1,choice:1,score:1};
  function isNum(v){return typeof v==='number'&&isFinite(v);}
  function numMap(v){return isObj(v)&&Object.keys(v).every(function(k){return isNum(v[k]);});}
  function decodeSystemOne(body,status,headers,endpoint){
    function bad(path){return new JevResponseValidationError(status,body,headers,path,endpoint);}
    if(!isObj(body)) throw bad('');
    if(typeof body.model!=='string') throw bad('model');
    if(!isObj(body.answers)) throw bad('answers');
    var answers={}, nouls={}, choices={}, scores={};
    Object.keys(body.answers).forEach(function(n){
      var a=body.answers[n], at='answers.'+n;
      if(!isObj(a)||typeof a.type!=='string') throw bad(at+'.type');
      if(!ANSWER_TYPES[a.type]) return;                                     // 以後新增的答案種類：略過，不讓整個回應失敗
      if(a.type==='noul'){ if(!isNum(a.noul)) throw bad(at+'.noul'); nouls[n]=a; }
      else if(a.type==='choice'){
        if(typeof a.choice!=='string') throw bad(at+'.choice'); if(!isNum(a.confidence)) throw bad(at+'.confidence'); if(!numMap(a.probabilities)) throw bad(at+'.probabilities'); choices[n]=a;
      } else {
        if(!isNum(a.score)) throw bad(at+'.score'); if(!isNum(a.confidence)) throw bad(at+'.confidence');
        if(!isObj(a.legend)) throw bad(at+'.legend'); if(!numMap(a.probabilities)) throw bad(at+'.probabilities'); scores[n]=a;
      }
      answers[n]=a;
    });
    var u=isObj(body.usage)?body.usage:{};
    return {model:body.model,usage:{input_tokens:isNum(u.input_tokens)?u.input_tokens:null,output_tokens:isNum(u.output_tokens)?u.output_tokens:null},answers:answers,nouls:nouls,choices:choices,scores:scores,raw:body};
  }
  function decodeModels(body,status,headers,endpoint){
    if(!isObj(body)||!Array.isArray(body.models)) throw new JevResponseValidationError(status,body,headers,'models',endpoint);
    body.models.forEach(function(m,i){['name','description','release_date'].forEach(function(f){
      if(!m||typeof m[f]!=='string') throw new JevResponseValidationError(status,body,headers,'models.'+i+'.'+f,endpoint);});});
    return {models:body.models};
  }

  /* ---------- 重試 ---------- */
  var DEFAULT_RETRY={maxRetries:2,backoffInitial:0.5,backoffMax:5,backoffJitter:0.25,statuses:null,respectRetryAfter:true,timeout:30};
  function retryableStatus(s,list){return list?list.indexOf(s)>=0:(s===408||s===429||(s>=500&&s<600));}
  function backoff(attempt,p){
    if(!p.backoffInitial||!p.backoffMax) return 0;
    var exp=Math.min(p.backoffMax,p.backoffInitial*Math.pow(2,attempt-1));
    return Math.min(exp,Math.round(exp*(1-Math.random()*p.backoffJitter)*1000)/1000)*1000;
  }

  /* ---------- 客戶端 ---------- */
  class JevClient{
    constructor(opts){
      opts=opts||{};
      var key=String(opts.apiKey!=null?opts.apiKey:(ENV.TYPESAFE_API_KEY||'')).trim();
      if(!key) throw new JevError('No API key was provided. Pass apiKey or set the TYPESAFE_API_KEY environment variable.');
      if(!/^[\x21-\x7e]+$/.test(key)) throw new JevError('API key must contain only printable ASCII characters without whitespace.');
      this.apiKey=key;
      this.baseUrl=String(opts.baseUrl||ENV.TYPESAFE_BASE_URL||DEFAULT_BASE_URL).replace(/\/+$/,'');
      this.model=opts.model||ENV.TYPESAFE_DEFAULT_MODEL||DEFAULT_MODEL;
      this.timeout=opts.timeout!=null?opts.timeout:10;                                  // 秒：每次 HTTP 請求
      this.retry=Object.assign({},DEFAULT_RETRY,opts.retry||{});
      this.headers=opts.headers||{};
      this._fetch=opts.fetch||(typeof fetch!=='undefined'?fetch.bind(globalThis):null);
      this._sleep=opts.sleep||function(ms){return new Promise(function(r){setTimeout(r,ms);});};
      if(!this._fetch) throw new JevError('No fetch implementation is available; pass opts.fetch.');
      var self=this; this.models={list:function(o){return self._send('GET',MODELS_PATH,null,o||{},decodeModels);}};
    }
    async systemOne(req){ // async：連本地檢查沒過也是 reject，不是同步丟出
      req=req||{};
      if(req.state==null) throw new JevError('State is required.');
      normalizeQuestions(req.questions);
      var body={state:req.state,model:req.model||this.model,questions:req.questions};
      if(req.extraBody) Object.assign(body,req.extraBody);
      return this._send('POST',SYSTEM_ONE_PATH,body,req,decodeSystemOne);
    }
    async _send(method,path,body,o,decode){
      var policy=Object.assign({},this.retry,o.retry||{}), started=Date.now(), attempt=0;
      for(;;){
        try{return await this._once(method,path,body,o,decode);}
        catch(e){
          var can=e instanceof JevTimeoutError?true:e instanceof JevConnectionError?true:e instanceof JevAPIError&&!(e instanceof JevResponseValidationError)&&retryableStatus(e.status,policy.statuses);
          if(!can||attempt>=policy.maxRetries) throw e;
          var ra=policy.respectRetryAfter&&e instanceof JevAPIError?e.retryAfterMs:null;
          var delay=ra!=null?ra:backoff(attempt+1,policy);
          if(policy.timeout!=null&&Date.now()-started+delay>=policy.timeout*1000) throw e;
          attempt++; await this._sleep(delay);
        }
      }
    }
    async _once(method,path,body,o,decode){
      var url=this.baseUrl+path, endpoint=method+' '+url;
      var headers=Object.assign({},this.headers,o.extraHeaders||{},{authorization:'Bearer '+this.apiKey,accept:'application/json'});
      if(body!=null) headers['content-type']='application/json';
      var ctl=typeof AbortController!=='undefined'?new AbortController():null, timeoutMs=(o.timeout!=null?o.timeout:this.timeout)*1000, timer=null, timedOut=false;
      if(ctl) timer=setTimeout(function(){timedOut=true;ctl.abort();},timeoutMs);
      if(o.signal&&ctl) o.signal.addEventListener('abort',function(){ctl.abort();});
      var res, text;
      try{
        res=await this._fetch(url,{method:method,headers:headers,body:body!=null?JSON.stringify(body):undefined,signal:ctl?ctl.signal:undefined});
        text=await res.text();
      }catch(e){
        if(timedOut) throw new JevTimeoutError('Request timed out (timeout='+(timeoutMs/1000)+'s).');
        if(o.signal&&o.signal.aborted) throw e;
        throw new JevConnectionError('Connection error: '+(e&&e.message||e));
      }finally{if(timer) clearTimeout(timer);}
      var h={}; res.headers.forEach(function(v,k){h[k.toLowerCase()]=v;});
      var parsed=null; if(text){try{parsed=JSON.parse(text);}catch(e){parsed=text;}}
      if(!res.ok) throw apiError(res.status,parsed,h,endpoint);
      return decode(parsed,res.status,h,endpoint);
    }
  }
  JevClient.noul=noul; JevClient.choice=choice; JevClient.score=score;
  JevClient.JevError=JevError; JevClient.JevAPIError=JevAPIError; JevClient.JevBadRequestError=JevBadRequestError; JevClient.JevAuthenticationError=JevAuthenticationError;
  JevClient.JevPermissionDeniedError=JevPermissionDeniedError; JevClient.JevNotFoundError=JevNotFoundError; JevClient.JevUnprocessableEntityError=JevUnprocessableEntityError;
  JevClient.JevRateLimitError=JevRateLimitError; JevClient.JevInternalServerError=JevInternalServerError; JevClient.JevResponseValidationError=JevResponseValidationError;
  JevClient.JevConnectionError=JevConnectionError; JevClient.JevTimeoutError=JevTimeoutError;
  JevClient.DEFAULT_BASE_URL=DEFAULT_BASE_URL; JevClient.DEFAULT_MODEL=DEFAULT_MODEL;
  return JevClient;
})();
if(typeof module!=='undefined'&&module.exports) module.exports=JevClient;
