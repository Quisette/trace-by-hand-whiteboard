/* NLBoard — natural-language script → whiteboard components.
 *
 * Every script line is one sentence ("array nums = [2,7,11,15]", "move i to 1",
 * "把 2 推入 stack"). A line is lexed, tagged against what is already on the
 * board (a known pointer name becomes PTR, a number NUM …) and that tagged
 * state goes to Jev (see jev.js), which answers typed questions in a single
 * pass: which intent, which component type, is it negated, which way to step.
 * The answers pick a deterministic handler that changes the board model.
 *
 * Ownership: a component made by a line is keyed by that line's id. Editing
 * the line updates it in place; deleting the line removes it. The page only
 * lets the user move such components, never delete them directly.
 *
 * replay(lines, step) re-runs the whole script from scratch, so the board is
 * always exactly what the script says, and `step` shows the board as it was
 * right after that line (stepping through a trace).
 */
var NLBoard=(function(J){
  var TAG={array:'ARR',string:'STRG',pointer:'PTR',var:'VAR',stack:'STK',queue:'QUE',dict:'MAP',set:'SET',title:'TXT',note:'TXT'};
  var CONTAINERS=['stack','queue','set','array','string','dict'];

  /* ---------- 詞法 ---------- */
  var KW=(('a an the of with at to into onto in on from by as be is are was it its this that then now and or so let set make create new add put push pop append enqueue dequeue insert remove delete erase '+
    'move moves moved advance step increment decrement inc dec go goes left right next back forward update becomes become becoming change changes store record mark marked highlight unmark done visited cross '+
    'return returns answer result output is isn not no yes check verify whether does contains contain has empty top front pointer pointers array list string str var variable variables stack queue deque '+
    'dict map hashmap hash dictionary set hashset title note comment problem called named name value values key keys index at cell element item one equal equals same true false null none nil len size '+
    'we our i\'ll ill should must first last call push_back pop_back popleft get still keep found find need needed for each over across range enumerate while elif else otherwise break continue repeat times loop iterate foreach through peek').split(' ')).reduce(function(m,w){m[w]=1;return m;},{});
  var SOFT={i:1,x:1,j:1,k:1,need:1,top:1,left:1,right:1,result:1,answer:1,cur:1,prev:1,next:1,first:1,last:1,set:0}; // 常被拿來當名字的字
  function half(s){return String(s).replace(/[！-～]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0xfee0);}).replace(/　/g,' ').replace(/[「『“”]/g,'"').replace(/[」』]/g,'"').replace(/[，、]/g,',').replace(/[。；]/g,' ');}
  function lex(text){
    var s=half(text), out=[], i=0, m;
    while(i<s.length){
      var c=s[i], rest=s.slice(i);
      if(/\s/.test(c)){i++;continue;}
      if(c==='"'||c==="'"){var j=s.indexOf(c,i+1); if(j<0) j=s.length; out.push({k:'str',v:s.slice(i+1,j),s:i,e:Math.min(s.length,j+1)}); i=j+1; continue;}
      if(c==='['){
        var prev=out[out.length-1], idx=prev&&!prev.sp&&(prev.k==='id'||prev.k==='word'||prev.v===']'||prev.v===')')&&s[i-1]&&!/\s/.test(s[i-1]);
        if(!idx){ // 字面清單：整段收成一個 list
          var d=0,j2=i; for(;j2<s.length;j2++){if(s[j2]==='[')d++; else if(s[j2]===']'){d--; if(!d) break;}}
          out.push({k:'list',v:s.slice(i,j2+1),s:i,e:j2+1}); i=j2+1; continue; }
      }
      if((m=rest.match(/^\d+(\.\d+)?/))){out.push({k:'num',v:m[0],s:i,e:i+m[0].length}); i+=m[0].length; continue;}
      if((m=rest.match(/^[A-Za-z_][A-Za-z0-9_]*(?:'[a-z]+)?/))){out.push({k:'id',v:m[0],s:i,e:i+m[0].length}); i+=m[0].length; continue;}
      if((m=rest.match(/^(->|=>|==|!=|<=|>=|&&|\|\||\+\+|--|\+=|-=|→)/))){out.push({k:'sym',v:m[0]==='→'?'->':m[0],s:i,e:i+m[0].length}); i+=m[0].length; continue;}
      if(J.isCJK(c)){out.push({k:'cjk',v:c,s:i,e:i+1}); i++; continue;}
      out.push({k:'sym',v:c,s:i,e:i+1}); i++;
    }
    return out;
  }
  /* 依照板子上已經有的東西貼標籤 */
  function tag(toks,st){
    toks.forEach(function(t,n){
      if(t.k!=='id') return;
      var low=t.v.toLowerCase(), c=st.byName[t.v], nx=toks[n+1], pv=toks[n-1];
      if(c){t.k='comp';t.c=c;return;}
      if(low==='true'||low==='false'){t.k='bool';return;}
      if(low==='len'&&nx&&nx.v==='('){t.k='fn';return;}
      var assignish=nx&&nx.k==='sym'&&['=','+=','-=','++','--','['].indexOf(nx.v)>=0&&!(nx.v==='['&&KW[low]&&!SOFT[low]);
      var named=pv&&pv.k!=='comp'&&['called','named','array','list','string','pointer','var','variable','stack','queue','dict','map','hashmap','set','hashset','deque','let'].indexOf(pv.v.toLowerCase())>=0&&!KW[low];
      if(KW[low]&&!assignish&&!named){t.k='word';t.v=low;return;}
      t.k='id';
    });
    return toks;
  }
  function stateText(toks){
    return toks.map(function(t){
      return t.k==='num'?'NUM':t.k==='str'?'STR':t.k==='list'?'LIST':t.k==='id'?'ID':t.k==='bool'?'BOOL':t.k==='comp'?TAG[t.c.type]:t.v;
    }).join(' ');
  }

  /* ---------- Jev 的題目 ---------- */
  var INTENTS={
    create:['array ID = LIST','array ID LIST','make an array ID with LIST','create array ID','new array ID','list ID = LIST','string ID = STR','string ID','new stack ID','stack ID','empty stack ID','make a stack called ID','queue ID','create a queue ID','dict ID','make a dict called ID','hash map ID','map ID','set ID','a set ID','make a set called ID','variable ID = NUM','var ID = NUM','variable ID','pointer ID at ARR [ NUM ]','pointer ID on ARR','pointer ID at NUM','pointer ID','add a pointer ID','title','title :','problem :','note','note :','comment :',
      '陣 列 ID = LIST','数 组 ID = LIST','建 立 陣 列 ID','新 增 堆 疊 ID','堆 疊 ID','栈 ID','佇 列 ID','队 列 ID','字 典 ID','建 立 字 典 ID','集 合 ID','變 數 ID = NUM','变 量 ID = NUM','字 串 ID = STR','指 標 ID 指 向 ARR [ NUM ]','指 针 ID','題 目 :','便 利 貼 :','筆 記'],
    assign:['ID = NUM','ID = ARR [ PTR ]','ID = STRG [ PTR ]','ID = pop STK','VAR = pop STK','ID = STK . pop ( )','VAR = STK . pop ( )','ID = STK [ NUM ]','VAR = dequeue QUE','VAR = STRG [ PTR ]','ID = VAR - ID','VAR = NUM','VAR = VAR - VAR','VAR = ARR [ PTR ]','set VAR to NUM','set ID to NUM','let VAR be NUM','VAR becomes NUM','update VAR to NUM','change VAR to NUM','PTR = NUM','move PTR to NUM','PTR moves to NUM','move PTR to index NUM','advance PTR','increment PTR','PTR ++','PTR += NUM','PTR --','decrement PTR','move PTR right','move PTR left','step PTR forward','ARR [ NUM ] = NUM','VAR += NUM','VAR ++','ID = STR',
      '把 VAR 設 為 NUM','VAR 改 成 NUM','PTR 移 到 NUM','PTR 往 右','PTR 往 左','PTR 右 移','PTR 指 向 NUM','PTR 前 進'],
    push:['push NUM to STK','push NUM onto STK','push ARR [ PTR ] onto STK','push STR onto STK','STK push NUM','STK . push ( NUM )','append NUM to ARR','append NUM to QUE','enqueue NUM','enqueue NUM into QUE','add NUM to QUE','add NUM to SET','SET add NUM','SET . add ( NUM )','insert NUM into SET','push','append','enqueue',
      '把 NUM 推 入 STK','NUM 推 入 STK','推 入 STK','把 NUM 放 進 SET','NUM 加 入 QUE','NUM 加 入 SET','加 入 SET','壓 入 STK','压 入'],
    pop:['pop STK','pop from STK','pop the top of STK','STK . pop ( )','STK pop','pop QUE','dequeue QUE','dequeue','pop front of QUE','QUE . popleft ( )','pop STR from STK','pop',
      '彈 出 STK','STK 彈 出','弹 出','從 QUE 取 出','出 隊'],
    put:['put NUM -> NUM into MAP','put NUM : NUM in MAP','put VAR -> PTR into MAP','put ID -> PTR into MAP','MAP [ NUM ] = NUM','MAP [ VAR ] = PTR','store NUM -> NUM in MAP','record NUM : NUM in MAP','add NUM : NUM to MAP','add NUM -> NUM to MAP','MAP put NUM NUM','put',
      '把 NUM : NUM 放 進 MAP','把 VAR -> PTR 放 進 MAP','MAP 記 下 NUM -> NUM','存 入 MAP'],
    remove:['remove NUM from SET','remove NUM from MAP','delete NUM from MAP','delete key NUM from MAP','erase NUM from SET','SET remove NUM','remove',
      '從 SET 移 除 NUM','SET 刪 掉 NUM','刪 除 MAP NUM'],
    mark:['highlight ARR [ NUM ]','highlight ARR [ PTR ]','mark ARR [ PTR ] as done','mark ARR [ NUM ] done','cross out ARR [ NUM ]','highlight ARR NUM','mark STRG [ PTR ]',
      '標 記 ARR [ NUM ]','ARR [ NUM ] 標 黃','劃 掉 ARR [ NUM ]'],
    assert:['NUM in MAP','NUM is in MAP','NUM is not in MAP','VAR not in MAP','VAR is not in MAP','ID is in MAP','check NUM in SET','is NUM in MAP ?','VAR in SET','VAR == NUM','VAR is NUM','PTR is NUM','VAR != NUM','STK is empty','STK is not empty','check STK is empty','check VAR == NUM','ARR [ PTR ] == NUM',
      'NUM 在 MAP 裡','VAR 在 MAP 裡','NUM 不 在 MAP 裡','VAR 不 在 MAP','STK 是 空 的','STK 不 是 空 的','VAR 等 於 NUM'],
    ret:['return LIST','return NUM','return BOOL','return [ MAP [ VAR ] , PTR ]','return VAR','answer is LIST','answer : LIST','the answer is BOOL','result = LIST','output LIST','return true','return false',
      '回 傳 LIST','回 傳 BOOL','返 回 LIST','答 案 是 LIST','答 案 :']
  };
  var CTYPES={
    array:['array','list','nums','陣 列','数 组','列 表','配 列','배 열'],
    string:['string','str','STR','字 串','字 符 串','文 字 列'],
    pointer:['pointer','index','ptr','cursor','指 標','指 针','索 引','ポ イ ン タ'],
    var:['variable','var','let','變 數','变 量','変 数','변 수'],
    stack:['stack','堆 疊','栈','堆 栈','ス タ ッ ク','스 택'],
    queue:['queue','deque','佇 列','队 列','キ ュ ー','큐'],
    dict:['dict','map','hashmap','hash map','dictionary','字 典','雜 湊','哈 希 表','映 射','辞 書'],
    set:['set','hashset','a set','集 合'],
    title:['title','problem','題 目','标 题','標 題','题 目'],
    note:['note','comment','sticky','便 利 貼','筆 記','說 明','备 注','メ モ']
  };
  var NEG={yes:['not','isn\'t','is not','not in','no','!=','false','不','沒 有','没 有','非','不 在','不 是'],no:['is','in','yes','==','在','是','有']};
  var STEP_LEFT=['decrement PTR','PTR --','move PTR left','move PTR back','PTR moves left','PTR 往 左','PTR 左 移','PTR 後 退','上 一 格'],
      STEP_SET=['set PTR to NUM','PTR = NUM','move PTR to NUM','PTR 移 到 NUM'],
      STEP_RIGHT=['increment PTR','PTR ++','advance PTR','move PTR right','move PTR forward','step PTR forward','PTR moves right','next','PTR 往 右','PTR 右 移','PTR 前 進','下 一 格'];

  /* ---------- 問 Jev 的題目 ----------
   * 都是 System One 的格式（type / instructions / criteria），所以同一份問題可以丟給本機的 src/jev.js，
   * 也可以丟給任何 Jev 相容的 API（見 prime）。同一個狀態句一次問完所有題目。
   * 本機比對器看 criteria 裡的範例句；instructions 是寫給真正的模型看的。 */
  var QSETS={
    line:{
      intent:{type:'choice',instructions:'What does this whiteboard sentence do?',criteria:INTENTS},
      ctype:{type:'choice',instructions:'Which kind of component does the sentence mention or create?',criteria:CTYPES},
      neg:{type:'noul',instructions:'Is the sentence negated, as in "not in", "is not" or "!="?',criteria:{true:NEG.yes,false:NEG.no}},
      delta:{type:'score',instructions:'How does the pointer move? 0 = one step left, 1 = jumps to a given index, 2 = one step right.',criteria:[STEP_LEFT,STEP_SET,STEP_RIGHT]}
    },
    loop:{loop:{type:'choice',instructions:'What kind of for loop is this header?',criteria:null}} // criteria 在 LOOPKINDS 定義後補上
  };
  var CACHE={line:{},loop:{}}, MISS={}, NCACHE=0;
  function infer(kind,state){ // 同一個狀態句的答案是固定的：算一次就記起來
    var r=CACHE[kind][state]; if(r) return r;
    if(++NCACHE>4000){CACHE={line:{},loop:{}};NCACHE=0;}
    r=J.systemOne({state:state,model:J.ALIAS,questions:QSETS[kind]}).answers;
    CACHE[kind][state]=r; MISS[kind+'\u0000'+state]=1; return r;
  }
  function decide(stateTxt){return infer('line',stateTxt);}
  function decideLoop(stateTxt){return infer('loop',stateTxt).loop;}
  /* 到目前為止是「本機」答的狀態句，改問一個真的 Jev API（或任何相容的伺服器）。client 是 src/jev-client.js 的
   * JevClient（或有同樣 systemOne 的東西）；它的答案會換掉快取，之後重跑腳本就用它的答案。形狀不對的答案不收。 */
  function prime(client,opts){
    opts=opts||{};
    var keys=Object.keys(MISS), updated=0, failed=0, i=0; MISS={};
    function shaped(a,kind){
      if(kind==='loop') return !!(a.loop&&a.loop.type==='choice'&&a.loop.probabilities&&a.loop.choice);
      return !!(a.intent&&a.intent.type==='choice'&&a.intent.probabilities&&a.ctype&&a.ctype.type==='choice'&&a.ctype.probabilities&&a.neg&&a.neg.type==='noul'&&typeof a.neg.noul==='number'&&a.delta&&a.delta.type==='score'&&typeof a.delta.score==='number');
    }
    function one(k){
      var at=k.indexOf('\u0000'), kind=k.slice(0,at), state=k.slice(at+1);
      return client.systemOne({state:state,questions:QSETS[kind]}).then(function(resp){
        if(resp&&resp.answers&&shaped(resp.answers,kind)){CACHE[kind][state]=resp.answers;updated++;} else failed++;
      },function(){failed++;});
    }
    function worker(){return i>=keys.length?Promise.resolve():one(keys[i++]).then(worker);}
    var ws=[]; for(var w=0;w<Math.min(opts.concurrency||4,keys.length);w++) ws.push(worker());
    return Promise.all(ws).then(function(){return {asked:keys.length,updated:updated,failed:failed};});
  }

  /* ---------- 值 ---------- */
  function truthy(v){if(Array.isArray(v)||typeof v==='string') return v.length>0&&v!=='false'; if(v&&typeof v==='object') return Object.keys(v).length>0; return !!v;}
  function unq(s){return String(s).trim().replace(/^["']|["']$/g,'');}
  function num(v){if(typeof v==='number')return v; if(typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v.trim()))return +v; return v;}
  function fmt(v){
    if(v===undefined) return '';
    if(v===null) return 'null';
    if(Array.isArray(v)) return '['+v.map(fmt).join(',')+']';
    if(typeof v==='object') return '{'+Object.keys(v).map(function(k){return k+':'+fmt(v[k]);}).join(', ')+'}';
    return String(v);
  }
  function same(a,b){return fmt(num(a))===fmt(num(b));}
  function splitItems(inner,raw){ // 逗號分隔，引號和括號裡的逗號不算
    var out=[],d=0,cur='',q=null;
    for(var i=0;i<inner.length;i++){var c=inner[i];
      if(q){cur+=c; if(c===q) q=null; continue;}
      if(c==='"'||c==="'"){q=c;cur+=c;continue;}
      if(c==='['||c==='{'||c==='(') d++; if(c===']'||c==='}'||c===')') d--;
      if(c===','&&!d){out.push(cur.trim());cur='';continue;}
      cur+=c;}
    if(cur.trim()) out.push(cur.trim());
    return raw?out:out.map(function(x){return x.replace(/^["']|["']$/g,'');});
  }
  function listVals(src){ // "[2, 7, 11]" → ['2','7','11']
    var inner=src.replace(/^\s*\[|\]\s*$/g,'').trim(); if(!inner) return [];
    return splitItems(inner);
  }
  function dictLiteral(text){ // {")": "(", "]": "["} → [[')','('],[']','[']]
    var t=half(text), i=-1, q=null, k, c;
    for(k=0;k<t.length;k++){c=t[k]; if(q){if(c===q)q=null;continue;} if(c==='"'||c==="'"){q=c;continue;} if(c==='{'){i=k;break;}}
    if(i<0) return null;
    var d=0, j=-1; q=null;
    for(k=i;k<t.length;k++){c=t[k]; if(q){if(c===q)q=null;continue;} if(c==='"'||c==="'"){q=c;continue;} if(c==='{')d++; else if(c==='}'){d--; if(!d){j=k;break;}}}
    if(j<0) j=t.length;
    return splitItems(t.slice(i+1,j),true).map(function(p){var sp=splitColon(p); if(sp.inline) return [unq(sp.head),unq(sp.inline)]; var kv=p.split(/\s*->\s*/); return [unq(kv[0]),unq(kv[1]||'')];});
  }
  function compValue(c){
    switch(c.type){
      case 'var': return num(c.value);
      case 'pointer': return c.idx;
      case 'dict': var o={}; c.rows.forEach(function(r){o[r[0]]=num(r[1]);}); return o;
      case 'title': case 'note': return c.text;
      default: return c.cells.map(num);
    }
  }
  /* 小小的運算式：+ - * / % 比較、索引、len()、清單 */
  function evaluate(toks,st){
    var p=0;
    function peek(){return toks[p];}
    function eat(v){if(toks[p]&&toks[p].v===v){p++;return true;}return false;}
    function fail(m){throw new Error(m);}
    var POPW=/^(pop|popleft|dequeue)$/, PEEKW=/^(peek|top|front)$/;
    function member(v,c){if(Array.isArray(c))return c.some(function(x){return same(x,v);}); if(typeof c==='string')return c.indexOf(String(v))>=0; if(c&&typeof c==='object')return String(v) in c; return false;}
    function popFrom(c){if(!c||!c.cells) fail('cannot pop from "'+(c&&c.name||'that')+'"'); if(!c.cells.length) fail(c.name+' is empty, nothing to pop');
      var v=c.type==='queue'?c.cells.shift():c.cells.pop(); st.events.push({t:'pop',box:c.name,v:v,line:st.cur}); return num(v);}
    function peekAt(c){if(!c||!c.cells||!c.cells.length) fail('"'+(c&&c.name||'that')+'" is empty'); return num(c.type==='queue'?c.cells[0]:c.cells[c.cells.length-1]);}
    function primary(){
      var t=toks[p++]; if(!t) fail('missing value');
      if(t.k==='num') return +t.v;
      if(t.k==='str') return t.v;
      if(t.k==='bool') return t.v.toLowerCase()==='true';
      if(t.k==='list') return listVals(t.v).map(function(x){
        try{var sub=tag(lex(x),st); return sub.length===1&&sub[0].k==='id'?x:evaluate(sub,st);}catch(e){return num(x);}});
      if(t.k==='comp'){var n1=toks[p],n2=toks[p+1];
        if(n1&&n1.v==='.'&&n2&&n2.k==='word'&&(POPW.test(n2.v)||PEEKW.test(n2.v))){p+=2;if(eat('('))eat(')');return POPW.test(n2.v)?popFrom(t.c):peekAt(t.c);}
        return compValue(t.c);}
      if(t.k==='fn'){eat('(');var v=expr();eat(')');return v&&v.length!=null?v.length:Object.keys(v||{}).length;}
      if(t.v==='('){var v2=expr();eat(')');return v2;}
      if(t.k==='word'&&(POPW.test(t.v)||PEEKW.test(t.v))){var nt=toks[p]; if(nt&&nt.k==='word'&&nt.v==='of') nt=toks[++p];
        if(nt&&nt.k==='comp'){p++; return POPW.test(t.v)?popFrom(nt.c):peekAt(nt.c);} fail('which stack or queue?');}
      if(t.k==='word'&&(t.v==='null'||t.v==='none'||t.v==='nil')) return null;
      if(t.k==='id') fail('unknown name "'+t.v+'"');
      fail('cannot read "'+t.v+'"');
    }
    function post(){var v=primary();
      while(peek()&&peek().v==='['){p++;var i=expr();eat(']');
        if(Array.isArray(v)||typeof v==='string'){if(typeof i==='number'&&i<0&&-i<=v.length) i=v.length+i; if(typeof i!=='number'||i<0||i>=v.length) fail('index '+fmt(i)+' is out of range'); v=num(v[i]);}
        else if(v&&typeof v==='object'){if(!(String(i) in v)) fail('key '+fmt(i)+' is not in the dict'); v=v[String(i)];}
        else fail('cannot index '+fmt(v));}
      return v;}
    function unary(){if(eat('-'))return -unary(); return post();}
    function mul(){var v=unary();for(;;){if(eat('*'))v=v*unary();else if(eat('/'))v=Math.trunc(v/unary());else if(eat('%'))v=v%unary();else return v;}}
    function add(){var v=mul();for(;;){if(eat('+'))v=v+mul();else if(eat('-'))v=v-mul();else return v;}}
    function isW(t,w){return t&&t.k==='word'&&t.v===w;}
    function empty_(v){return v==null||(Array.isArray(v)||typeof v==='string'?v.length===0:typeof v==='object'?Object.keys(v).length===0:false);}
    function cmp(){var v=add(),t=peek();
      if(isW(t,'not')&&isW(toks[p+1],'in')){p+=2;return !member(v,add());}
      if(isW(t,'in')){p++;return member(v,add());}
      if(isW(t,'is')||isW(t,'equals')||isW(t,'are')){p++; var ng=false; if(isW(peek(),'not')){p++;ng=true;}
        if(isW(peek(),'empty')){p++;var em=empty_(v);return ng?!em:em;}
        if(isW(peek(),'in')){p++;var mm=member(v,add());return ng?!mm:mm;}
        var w0=add(), eq=same(v,w0); return ng?!eq:eq;}
      if(t&&['==','!=','<','>','<=','>='].indexOf(t.v)>=0){p++;var w=add();
        return t.v==='=='?same(v,w):t.v==='!='?!same(v,w):t.v==='<'?v<w:t.v==='>'?v>w:t.v==='<='?v<=w:v>=w;}return v;}
    function not_(){var t=peek(); if((isW(t,'not')&&!isW(toks[p+1],'in'))||(t&&t.k==='sym'&&t.v==='!')){p++;return !truthy(not_());} return cmp();}
    function and_(){var v=not_();for(;;){var t=peek(); if(isW(t,'and')||(t&&t.k==='sym'&&t.v==='&&')){p++;var w=not_();v=truthy(v)&&truthy(w);}else return v;}}
    function or_(){var v=and_();for(;;){var t=peek(); if(isW(t,'or')||(t&&t.k==='sym'&&t.v==='||')){p++;var w=and_();v=truthy(v)||truthy(w);}else return v;}}
    function expr(){return or_();}
    var list=[]; // 逗號分隔 → 清單
    if(!toks.length) fail('missing value');
    list.push(expr()); while(eat(',')) list.push(expr());
    if(p<toks.length) fail('did not understand "'+toks.slice(p).map(function(t){return t.v;}).join(' ')+'"');
    return list.length>1?list:list[0];
  }

  /* ---------- 狀態 ---------- */
  function newState(){return {comps:[],byName:{},answer:undefined,events:[],ptrColor:0};}
  function cloneState(st){var c=JSON.parse(JSON.stringify(st)); c.byName={}; c.comps.forEach(function(x){if(x.name)c.byName[x.name]=x;}); return c;}
  function addComp(st,c){
    var ex=c.name&&st.byName[c.name];
    if(ex&&c.type!=='title'&&c.type!=='note'){
      if(ex.key!==c.key) throw new Error('"'+c.name+'" already exists');
      st.comps[st.comps.indexOf(ex)]=c; st.byName[c.name]=c; return c;} // 同一行再跑一次（迴圈裡）：重設
    st.comps.push(c); if(c.name) st.byName[c.name]=c; return c;}
  function blank(type,key,line,name){
    var c={key:key,line:line,type:type,name:name||''};
    if(type==='var') c.value='';
    else if(type==='pointer'){c.target=null;c.idx=0;}
    else if(type==='dict') c.rows=[];
    else if(type==='title'||type==='note') c.text='';
    else c.cells=[];
    if(type==='array'||type==='string'){c.hl=[];c.done=[];}
    return c;
  }

  /* ---------- 找出句子裡的各個部分 ---------- */
  var FILL={a:1,an:1,the:1,of:1,value:1,values:1,it:1,its:1,then:1,now:1,so:1,and:1,we:1,on:1,onto:1,into:1,in:1,to:1,at:1,from:1,with:1,'.':1,'?':1,'!':1,'(':0,')':0,
    push:1,pop:1,append:1,enqueue:1,dequeue:1,add:1,insert:1,put:1,store:1,record:1,remove:1,delete:1,erase:1,key:1,check:1,is:1,does:1,contain:1,contains:1,has:1,whether:1,not:1,no:1,yes:1,
    popleft:1,push_back:1,pop_back:1,get:1,top:1,front:1,element:1,item:1,cell:1,index:1,still:1,found:1,find:1,need:1,needed:1};
  var CJKFILL='把將将推入進进放加到在裡里中的了取出從从刪删除移掉存記记下壓压彈弹嗎吗是不沒没有呢個个也還还並并';
  function trimParens(ts){ // st.push(3) → 3
    while(ts.length>=2&&ts[0].v==='('&&ts[ts.length-1].v===')') ts=ts.slice(1,-1);
    if(ts.length===2&&ts[0].v==='('&&ts[1].v===')') return [];
    if(ts.length&&ts[0].v===')') ts=ts.slice(1);
    return ts;
  }
  function comps(toks,types){return toks.filter(function(t){return t.k==='comp'&&(!types||types.indexOf(t.c.type)>=0);});}
  function at(toks,v){for(var i=0;i<toks.length;i++)if(toks[i].v===v&&toks[i].k==='sym')return i;return -1;}
  function wordAt(toks,ws){for(var i=0;i<toks.length;i++)if((toks[i].k==='word'||toks[i].k==='cjk'||toks[i].k==='id')&&ws.indexOf(toks[i].v.toLowerCase())>=0)return i;return -1;}
  function cjkSeq(toks,seq){ // 找連續的中文詞
    var s=toks.map(function(t){return t.k==='cjk'?t.v:'\u0000';}).join(''), i=s.indexOf(seq); if(i<0) return -1; return i;}
  function rawAfter(text,toks,i){return i<toks.length?half(text).slice(toks[i].s).trim():'';}
  var LDROP={a:1,an:1,the:1,value:1,values:1,it:1,its:1,then:1,now:1,so:1};
  function exprToks(toks,from,to,logic){ // [from, to) 之間能算的部分；logic：保留 and / or / not / in / is / pop 這些運算用的字
    var ts=toks.slice(from,to==null?toks.length:to).filter(function(t){
      if(t.k==='cjk') return false;
      if(t.k==='sym'&&(t.v==='?'||(t.v==='!'&&!logic))) return false;
      if(t.k==='word') return logic?!LDROP[t.v]:!FILL[t.v];
      return true;});
    while(ts.length&&ts[ts.length-1].k==='sym'&&ts[ts.length-1].v==='.') ts.pop();
    return ts;
  }

  /* ---------- 每種意圖的處理 ---------- */
  var H={};
  H.create=function(L,toks,st,ans){
    var type=ans.ctype.choice, text=L.text;
    // 類型字要真的出現（避免「i = 3」被當成建立）
    var typeWordIdx=-1;
    toks.forEach(function(t,i){if(typeWordIdx<0&&(t.k==='word'||t.k==='cjk'||t.k==='id')){var lw=t.v.toLowerCase();
      for(var ty in CTYPES){ if(CTYPES[ty].some(function(h){return h.replace(/ /g,'')===lw||(t.k==='cjk'&&h.replace(/ /g,'').indexOf(lw)===0&&cjkSeq(toks,h.replace(/ /g,''))>=0);})){ typeWordIdx=i; if(ty!==type&&ans.ctype.probabilities[ty]>0.05) type=ty; break; } } }});
    if(typeWordIdx<0) return null;
    if(type==='title'||type==='note'){
      var after=typeWordIdx+1; if(toks[after]&&toks[after].k==='sym'&&toks[after].v===':') after++;
      if(toks[typeWordIdx].k==='cjk'){var seq=CTYPES[type].map(function(h){return h.replace(/ /g,'');}).filter(function(h){return cjkSeq(toks,h)>=0;})[0]||'';after=typeWordIdx+seq.length; if(toks[after]&&toks[after].v===':')after++;}
      var c=addComp(st,blank(type,L.id,L.id,'')); c.text=rawAfter(text,toks,after).replace(/^[:：]\s*/,''); return {sum:'+ '+type,comp:c};
    }
    // 名字：類型字後面第一個沒見過的名字；或 called / named 後面那個
    var name=null, ni=-1;
    toks.forEach(function(t,i){if(name==null&&t.k==='id'&&i>typeWordIdx-1&&!(toks[i-1]&&toks[i-1].v==='[')){name=t.v;ni=i;}});
    if(name==null) toks.forEach(function(t,i){if(name==null&&t.k==='id'){name=t.v;ni=i;}});
    if(name==null){ // 沒有名字：用類型當名字（stack、seen…）
      var auto={array:'arr',string:'s',pointer:'p',var:'v',stack:'stack',queue:'queue',dict:'map',set:'set'}[type]||type, k=1, base=auto; while(st.byName[auto]) auto=base+(++k); name=auto;}
    var c2=addComp(st,blank(type,L.id,L.id,name));
    var eq=at(toks,'='), rest=toks.slice(eq>=0?eq+1:ni+1);
    var lit=rest.filter(function(t){return t.k==='list'||t.k==='str';})[0];
    if(type==='array'||type==='stack'||type==='queue'||type==='set'||type==='string'){
      var vals=[];
      if(lit&&lit.k==='list') vals=listVals(lit.v);
      else if(lit&&lit.k==='str') vals=type==='string'||type==='array'?lit.v.split(''):[lit.v];
      else vals=rest.filter(function(t){return t.k==='num'||t.k==='bool';}).map(function(t){return t.v;});
      if(type==='string'&&vals.length===1&&vals[0].length>1) vals=vals[0].split('');
      if(type==='set') vals=vals.filter(function(v,i){return vals.indexOf(v)===i;});
      c2.cells=vals.map(String);
      return {sum:'+ '+type+' '+name+(vals.length?' '+fmt(vals):''),comp:c2};
    }
    if(type==='dict'){
      if(lit&&lit.k==='list') c2.rows=listVals(lit.v).map(function(p){var kv=p.split(/\s*(?::|->)\s*/);return [kv[0],kv[1]||''];});
      var dl=dictLiteral(text); if(dl) c2.rows=dl;
      return {sum:'+ dict '+name,comp:c2};
    }
    if(type==='var'){
      var et=exprToks(toks,eq>=0?eq+1:ni+1); if(et.length){var v=evaluate(et,st); c2.value=fmt(v);}
      return {sum:'+ var '+name+(c2.value!==''?' = '+c2.value:''),comp:c2};
    }
    if(type==='pointer'){
      var arr=comps(toks,['array','string'])[0], arrs=st.comps.filter(function(x){return x.type==='array'||x.type==='string';});
      if(!arr&&arrs.length===1) arr={c:arrs[0]};
      if(!arr) throw new Error('which array does "'+name+'" point into? e.g. "pointer '+name+' at nums[0]"');
      c2.target=arr.c.key; c2.color=[2,1,3,4][st.ptrColor++%4];
      var ai=toks.indexOf(arr), idx=0;
      if(toks[ai+1]&&toks[ai+1].v==='['){var close=toks.indexOf(toks.filter(function(t,i){return i>ai&&t.v===']';})[0]); idx=evaluate(toks.slice(ai+2,close),st);}
      else {var nt=exprToks(toks,Math.max(ni,ai)+1).filter(function(t){return t.k!=='comp';}); if(nt.length) idx=evaluate(nt,st);}
      if(typeof idx!=='number') throw new Error('pointer index must be a number');
      c2.idx=idx; st.events.push({t:'move',ptr:c2.name,arr:arr.c.name,idx:idx,line:L.id});
      return {sum:'+ pointer '+name+' → '+arr.c.name+'['+idx+']',comp:c2};
    }
    return null;
  };
  function setValue(c,v,st,L){
    if(c.type==='var'){c.value=fmt(v);return c.name+' = '+c.value;}
    if(c.type==='pointer'){if(typeof v!=='number')throw new Error(c.name+' is a pointer, give it an index'); c.idx=v; var a=keyed(st,c.target); st.events.push({t:'move',ptr:c.name,arr:a?a.name:null,idx:v,line:L.id}); return c.name+' → '+(a?a.name:'')+'['+v+']';}
    if(c.type==='array'||c.type==='string'||c.type==='stack'||c.type==='queue'||c.type==='set'){c.cells=(Array.isArray(v)?v:[v]).map(fmt);return c.name+' = '+fmt(v);}
    throw new Error('cannot assign to '+c.type+' "'+c.name+'"');
  }
  function keyed(st,key){for(var i=0;i<st.comps.length;i++)if(st.comps[i].key===key)return st.comps[i];return null;}
  H.assign=function(L,toks,st,ans){
    var ops=['=','+=','-=','++','--'], oi=-1;
    toks.forEach(function(t,i){if(oi<0&&t.k==='sym'&&ops.indexOf(t.v)>=0)oi=i;});
    var lhs, rhs=null, op='=';
    if(oi>=0){
      op=toks[oi].v; lhs=toks.slice(0,oi).filter(function(t){return !(t.k==='word'&&(t.v==='let'||t.v==='set'||t.v==='now'||t.v==='then'||t.v==='so'))&&t.k!=='cjk';});
      rhs=exprToks(toks,oi+1,null,true);
    } else {
      // set X to E / move X to E / X becomes E / 把 X 設為 E / X 移到 E
      var ti=-1; toks.forEach(function(t,i){if(ti<0&&(t.k==='comp'||t.k==='id'))ti=i;});
      if(ti<0) return null;
      lhs=[toks[ti]];
      if(toks[ti+1]&&toks[ti+1].v==='['){var cl=-1;for(var q=ti+1;q<toks.length;q++)if(toks[q].v===']'){cl=q;break;} if(cl>0){lhs=toks.slice(ti,cl+1);ti=cl;}}
      var si=-1; for(var k=ti+1;k<toks.length;k++){var w=toks[k].v.toLowerCase(); if(['to','be','becomes','as','at','=','is'].indexOf(w)>=0||toks[k].k==='cjk'&&'為为成到向'.indexOf(w)>=0){si=k;}else if(si>=0)break;}
      if(si>=0){rhs=exprToks(toks,si+1,null,true);}
      if(!rhs||!rhs.length){
        var d=ans.delta.score-1; if(Math.abs(d)<0.5) return null;   // 0 = 往左一格，1 = 跳到指定的位置，2 = 往右一格
        op=d>0?'++':'--';
      }
    }
    if(!lhs.length) return null;
    var tgt=lhs[0];
    // MAP[k] = v → 放進字典
    if(lhs.length>1&&lhs[1].v==='['){
      var key=evaluate(lhs.slice(2,lhs.length-1),st), val=evaluate(rhs,st);
      if(tgt.k!=='comp') throw new Error('no component named "'+tgt.v+'"');
      if(tgt.c.type==='dict'){putKV(tgt.c,key,val);st.events.push({t:'put',map:tgt.c.name,k:fmt(key),v:fmt(val),line:L.id});return {sum:tgt.c.name+'['+fmt(key)+'] = '+fmt(val)};}
      if(tgt.c.cells){if(typeof key!=='number'||key<0||key>=tgt.c.cells.length)throw new Error('index '+fmt(key)+' is out of range'); tgt.c.cells[key]=fmt(val); return {sum:tgt.c.name+'['+key+'] = '+fmt(val)};}
      throw new Error('cannot index "'+tgt.c.name+'"');
    }
    if(tgt.k==='comp'){
      var cur=compValue(tgt.c), v;
      if(op==='++') v=cur+1; else if(op==='--') v=cur-1;
      else {v=evaluate(rhs,st); if(op==='+=') v=num(cur)+v; if(op==='-=') v=num(cur)-v;}
      return {sum:setValue(tgt.c,v,st,L)};
    }
    if(tgt.k==='id'){ // 沒見過的名字：第一次給值就建立
      if(op!=='=') throw new Error('"'+tgt.v+'" has no value yet');
      var lit=rhs.length===1&&(rhs[0].k==='list'||rhs[0].k==='str')?rhs[0]:null, c;
      if(lit&&lit.k==='list'){c=addComp(st,blank('array',L.id,L.id,tgt.v));c.cells=listVals(lit.v);return {sum:'+ array '+tgt.v+' '+fmt(c.cells),comp:c};}
      if(lit&&lit.k==='str'&&lit.v.length>1){c=addComp(st,blank('string',L.id,L.id,tgt.v));c.cells=lit.v.split('');return {sum:'+ string '+tgt.v,comp:c};}
      var val2=evaluate(rhs,st); c=addComp(st,blank('var',L.id,L.id,tgt.v)); c.value=fmt(val2); return {sum:'+ var '+tgt.v+' = '+c.value,comp:c};
    }
    return null;
  };
  function putKV(c,k,v){k=fmt(k);v=fmt(v);var r=c.rows.filter(function(x){return x[0]===k;})[0]; if(r) r[1]=v; else c.rows.push([k,v]);}
  H.push=function(L,toks,st){
    var box=comps(toks,['stack','queue','set','array','string'])[0]; if(!box) return null;
    var rest=toks.filter(function(t){return t!==box;});
    // st.push(x) 形式
    var bi=toks.indexOf(box); if(toks[bi+1]&&toks[bi+1].v==='.'){rest=toks.slice(bi+3);}
    var et=trimParens(exprToks(rest,0)); if(!et.length) throw new Error('push what? e.g. "push 3 onto '+box.c.name+'"');
    var v=evaluate(et,st), vals=Array.isArray(v)&&et.length>1&&at(et,',')>=0?v:[v];
    vals.forEach(function(x){var s=fmt(x); if(box.c.type==='set'&&box.c.cells.indexOf(s)>=0) return; box.c.cells.push(s); st.events.push({t:'push',box:box.c.name,v:s,line:L.id});});
    return {sum:box.c.name+' ← '+vals.map(fmt).join(', ')};
  };
  H.pop=function(L,toks,st){
    var box=comps(toks,['stack','queue','array'])[0]; if(!box) return null;
    var eqi=at(toks,'='); if(eqi>=0&&eqi<toks.indexOf(box)) return null; // top = pop st：交給「給值」
    if(!box.c.cells.length) throw new Error(box.c.name+' is empty, nothing to pop');
    var v=box.c.type==='queue'?box.c.cells.shift():box.c.cells.pop();
    st.events.push({t:'pop',box:box.c.name,v:v,line:L.id});
    var bi=toks.indexOf(box), et=trimParens(exprToks(toks.filter(function(t,i){return t!==box&&!(i===bi+1&&t.v==='.')&&!(t.k==='id'&&/^pop|^dequeue|^popleft/.test(t.v));}),0));
    if(et.length){var want; try{want=evaluate(et,st);}catch(e){want=undefined;} if(want!==undefined&&!same(want,v)) return {sum:box.c.name+' → '+v,check:false,msg:'popped '+v+', not '+fmt(want)};}
    return {sum:box.c.name+' → '+v};
  };
  H.put=function(L,toks,st){
    var box=comps(toks,['dict'])[0]; if(!box) return null;
    if(toks[toks.indexOf(box)+1]&&toks[toks.indexOf(box)+1].v==='[') return H.assign(L,toks,st,{delta:{score:0}});
    var rest=exprToks(toks.filter(function(t){return t!==box;}),0), si=-1;
    rest.forEach(function(t,i){if(si<0&&t.k==='sym'&&['->','=>',':',','].indexOf(t.v)>=0)si=i;});
    if(si<0) rest.forEach(function(t,i){if(si<0&&t.k==='word'&&t.v==='as')si=i;});
    if(si<0) throw new Error('put what? e.g. "put x -> i into '+box.c.name+'"');
    var k=evaluate(rest.slice(0,si),st), v=evaluate(rest.slice(si+1),st);
    putKV(box.c,k,v); st.events.push({t:'put',map:box.c.name,k:fmt(k),v:fmt(v),line:L.id});
    return {sum:box.c.name+'['+fmt(k)+'] = '+fmt(v)};
  };
  H.remove=function(L,toks,st){
    var box=comps(toks,['set','dict','stack','queue','array'])[0]; if(!box) return null;
    var et=trimParens(exprToks(toks.filter(function(t){return t!==box;}),0)); var v=fmt(evaluate(et,st));
    if(box.c.type==='dict'){var n=box.c.rows.length; box.c.rows=box.c.rows.filter(function(r){return r[0]!==v;}); if(n===box.c.rows.length) throw new Error(v+' is not a key of '+box.c.name);}
    else {var i=box.c.cells.indexOf(v); if(i<0) throw new Error(v+' is not in '+box.c.name); box.c.cells.splice(i,1);}
    st.events.push({t:'remove',box:box.c.name,v:v,line:L.id});
    return {sum:box.c.name+' − '+v};
  };
  H.mark=function(L,toks,st){
    var arr=comps(toks,['array','string'])[0]; if(!arr) return null;
    if(wordAt(toks,['highlight','mark','marked','done','visited','cross'])<0&&!toks.some(function(t){return t.k==='cjk'&&'標标記记劃划淡黃黄'.indexOf(t.v)>=0;})) return null;
    var ai=toks.indexOf(arr), idx;
    if(toks[ai+1]&&toks[ai+1].v==='['){var close=-1;for(var q=ai+1;q<toks.length;q++)if(toks[q].v===']'){close=q;break;} idx=evaluate(toks.slice(ai+2,close),st);}
    else {var p=comps(toks,['pointer'])[0]; idx=p?p.c.idx:evaluate(exprToks(toks,ai+1).filter(function(t){return t.k==='num';}),st);}
    var done=wordAt(toks,['done','visited','cross','劃','划','淡'])>=0||cjkSeq(toks,'劃掉')>=0;
    var list=done?arr.c.done:arr.c.hl; if(list.indexOf(idx)<0) list.push(idx);
    return {sum:(done?'✓ ':'★ ')+arr.c.name+'['+idx+']'};
  };
  H.assert=function(L,toks,st,ans){
    var neg=ans.neg.noul>0.5, box=comps(toks,['dict','set','stack','queue','array','string'])[0];
    var empty=wordAt(toks,['empty'])>=0||cjkSeq(toks,'空')>=0;
    if(box&&empty){var n=box.c.type==='dict'?box.c.rows.length:box.c.cells.length, ok=(n===0)!==neg;
      return {sum:(neg?'¬ ':'')+box.c.name+' empty?',check:ok,msg:ok?'':box.c.name+' has '+n+' item(s)'};}
    var inIdx=wordAt(toks,['in','contains','has'])>=0||cjkSeq(toks,'在')>=0||cjkSeq(toks,'裡')>=0;
    if(box&&inIdx&&toks.indexOf(box)>0){
      var et=exprToks(toks.slice(0,toks.indexOf(box)),0).filter(function(t){return !(t.k==='word');});
      // 「need 7 is not in seen」：名字和數字都寫了 → 兩個都要對
      var parts=[]; if(et.length>1&&et[0].k==='comp'&&et[1].k==='num'){parts=[[et[0]],[et[1]]];} else parts=[et];
      var vals=parts.map(function(p){return evaluate(p,st);});
      if(vals.length===2&&!same(vals[0],vals[1])) return {sum:'check',check:false,msg:parts[0][0].v+' is '+fmt(vals[0])+', not '+fmt(vals[1])};
      var v=fmt(vals[0]), has=box.c.type==='dict'?box.c.rows.some(function(r){return r[0]===v;}):box.c.cells.indexOf(v)>=0, ok2=has!==neg;
      return {sum:v+(neg?' ∉ ':' ∈ ')+box.c.name,check:ok2,msg:ok2?'':v+(has?' is':' is not')+' in '+box.c.name};
    }
    var cut=-1, cutLen=1; toks.forEach(function(t,i){if(cut<0&&((t.k==='sym'&&['==','!=','='].indexOf(t.v)>=0)||(t.k==='word'&&(t.v==='is'||t.v==='equals'))||(t.k==='cjk'&&t.v==='等')))cut=i;});
    if(cut<0) return null;
    if(toks[cut].v==='等'&&toks[cut+1]&&'於于'.indexOf(toks[cut+1].v)>=0) cutLen=2;
    var a=exprToks(toks.slice(0,cut).filter(function(t){return !(t.k==='word');}),0), b=exprToks(toks.slice(cut+cutLen).filter(function(t){return !(t.k==='word'&&t.v!=='null'&&t.v!=='none');}),0);
    if(!a.length||!b.length) return null;
    var va=evaluate(a,st), vb=evaluate(b,st), eq=same(va,vb), neg2=neg||toks[cut].v==='!=', ok3=eq!==neg2;
    return {sum:fmt(va)+(neg2?' ≠ ':' = ')+fmt(vb),check:ok3,msg:ok3?'':'board says '+a.map(function(t){return t.v;}).join('')+' = '+fmt(va)};
  };
  H.ret=function(L,toks,st){
    var i=wordAt(toks,['return','returns','answer','result','output']), from=i+1;
    if(i<0){var c=cjkSeq(toks,'回傳'); if(c<0)c=cjkSeq(toks,'返回'); if(c<0)c=cjkSeq(toks,'答案'); if(c<0) return null; from=c+2;}
    while(toks[from]&&((toks[from].k==='word'&&['is','=','be'].indexOf(toks[from].v)>=0)||toks[from].v===':'||toks[from].v==='='||toks[from].k==='cjk')) from++;
    var et=exprToks(toks,from,null,true); if(!et.length) throw new Error('return what?');
    var v=evaluate(et,st); st.answer=v;
    var c2=keyed(st,L.id)||st.byName['return']||addComp(st,blank('var',L.id,L.id,'return')); c2.value=fmt(v); c2.ret=true;
    st.events.push({t:'return',v:fmt(v),line:L.id});
    return {sum:'return '+fmt(v),comp:c2};
  };

  /* ---------- 一行 ---------- */
  var ORDER=['create','assign','push','pop','put','remove','mark','assert','ret'];
  function runLine(L,st){
    var text=(L.text||'').trim();
    if(!text) return {status:'blank'};
    if(/^(#|\/\/)/.test(text)) return {status:'comment'};
    st.cur=L.id;
    var toks=tag(lex(text),st), state=stateText(toks), ans=decide(state);
    var probs=ans.intent.probabilities, tried=ORDER.slice().sort(function(a,b){return probs[b]-probs[a];}), lastErr=null;
    if(/^(return|returns|回傳|回传|返回)(?![A-Za-z0-9_])/i.test(half(text))) tried=['ret'].concat(tried.filter(function(x){return x!=='ret';})); // 開頭就寫 return：一定是回傳
    for(var n=0;n<tried.length;n++){
      var intent=tried[n]; if(probs[intent]<0.02&&n>0) break;
      var snap=JSON.stringify(st);
      toks=tag(lex(text),st);
      try{
        var r=H[intent](L,toks,st,ans);
        if(r){
          var res={status:r.check===false?'fail':r.check===true?'pass':'ok',intent:intent,p:probs[intent],confidence:ans.intent.confidence,sum:r.sum,msg:r.msg||'',state:state,alt:n};
          if(r.check===true) res.msg='';
          return res;
        }
      }catch(e){ lastErr=lastErr||{intent:intent,msg:e.message}; }
      restore(st,snap);
    }
    return {status:'err',intent:lastErr?lastErr.intent:tried[0],p:probs[tried[0]],confidence:ans.intent.confidence,sum:'',msg:lastErr?lastErr.msg:'could not understand this line',state:state};
  }
  function restore(st,snap){var o=JSON.parse(snap); for(var k in o) st[k]=o[k]; st.byName={}; st.comps.forEach(function(c){if(c.name)st.byName[c.name]=c;});}

  /* ---------- 流程：for / while / if / elif / else / repeat / break / continue ----------
   * 縮排就是區塊（跟 Python 一樣）；標題行最後的「:」可有可無；也可以寫成一行：「if need in seen: return …」。
   * 腳本被「跑」出來：每執行一次某一行就是一步（trace），所以迴圈裡的每一輪都能一步一步看。 */
  var LIMIT_STEPS=3000, LIMIT_LOOP=1000;
  function W(en,zh){return new RegExp('^(?:(?:'+en+')(?![A-Za-z0-9_])'+(zh?'|(?:'+zh+')':'')+')\\s*','i');}
  var FLOWS=[
    ['elif',W('elif|else\\s+if|otherwise\\s+if','否則如果|否则如果|不然如果|否則若|否则若')],
    ['else',W('else|otherwise','否則|否则|不然')],
    ['if',W('if','如果|若')],
    ['while',W('while','當|当')],
    ['for',W('for\\s+each|foreach|for|loop\\s+(?:over|through)|iterate\\s+(?:over|through)','對每個|對每一個|對於每個|針對每個|对每个|对每一个|遍歷|遍历')],
    ['repeat',W('repeat','重複|重复')],
    ['break',/^(?:break|stop\s+(?:the\s+)?loop|跳出|中斷|中断)\s*\.?$/i],
    ['continue',/^(?:continue|skip|next\s+iteration|繼續|继续|跳過|跳过)\s*\.?$/i]
  ];
  var BLOCKY={for:1,while:1,if:1,elif:1,else:1,repeat:1};
  function splitColon(rest){ // 標題和一行式的內容：第一個不在括號、引號裡的「:」
    var d=0,q=null;
    for(var i=0;i<rest.length;i++){var c=rest[i];
      if(q){if(c===q)q=null;continue;}
      if((c==='"'||c==="'")&&!(c==="'"&&i>0&&/[A-Za-z]/.test(rest[i-1]))){q=c;continue;}
      if('([{'.indexOf(c)>=0) d++; else if(')]}'.indexOf(c)>=0) d--;
      else if(c===':'&&d<=0) return {head:rest.slice(0,i).trim(),inline:rest.slice(i+1).trim()};}
    return {head:rest.trim(),inline:''};
  }
  function flowOf(text){
    var t=half(text).trim();
    for(var i=0;i<FLOWS.length;i++){var m=FLOWS[i][1].exec(t); if(!m) continue;
      var kind=FLOWS[i][0];
      if(kind==='break'||kind==='continue') return {kind:kind,head:'',inline:''};
      var sp=splitColon(t.slice(m[0].length)); return {kind:kind,head:sp.head,inline:sp.inline};}
    return null;
  }
  function hasFlow(lines){return lines.some(function(l){var t=String(l.text||'').trim(); return !!t&&!/^(#|\/\/)/.test(t)&&!!flowOf(t);});}
  function mkNode(i,L,text,ind,inline){
    var fl=flowOf(text), kind=fl?fl.kind:'plain';
    if(inline&&fl&&kind!=='break'&&kind!=='continue'){fl=null;kind='plain';} // 一行式只放一句、break 或 continue
    return {i:i,L:L,indent:ind,body:[],kind:kind,head:fl?fl.head:'',text:text};
  }
  function parseProgram(lines){
    var root={body:[],indent:-1}, stack=[root], stat={};
    lines.forEach(function(L,i){
      var raw=String(L.text==null?'':L.text).replace(/\t/g,'  '), t=raw.trim();
      if(!t){stat[i]='blank';return;}
      if(/^(#|\/\/)/.test(t)){stat[i]='comment';return;}
      var ind=raw.length-raw.replace(/^ +/,'').length, nd=mkNode(i,L,t,ind,false), fl=nd.kind!=='plain'?flowOf(t):null;
      while(stack.length>1&&stack[stack.length-1].indent>=ind) stack.pop();
      stack[stack.length-1].body.push(nd);
      if(fl&&fl.inline) nd.body.push(mkNode(i,L,fl.inline,ind+2,true));
      if(BLOCKY[nd.kind]) stack.push(nd);
    });
    return {body:root.body,stat:stat};
  }

  /* ---------- 條件：A in D、S is empty、x > 3、a and not b … ---------- */
  function balanced(ts){var d=0;for(var i=0;i<ts.length;i++){if(ts[i].v==='(')d++;else if(ts[i].v===')'){d--;if(d===0&&i<ts.length-1)return false;}}return d===0;}
  function splitTop(ts,isOp){var parts=[[]],d=0;ts.forEach(function(t){if(t.v==='('||t.v==='[')d++;else if(t.v===')'||t.v===']')d--; if(!d&&isOp(t)) parts.push([]); else parts[parts.length-1].push(t);});return parts;}
  function isAnd(t){return (t.k==='word'&&t.v==='and')||(t.k==='sym'&&t.v==='&&');}
  function isOr(t){return (t.k==='word'&&t.v==='or')||(t.k==='sym'&&t.v==='||');}
  function condOne(ts,L,st){
    var neg=false;
    while(ts.length&&((ts[0].k==='word'&&ts[0].v==='not')||(ts[0].k==='sym'&&ts[0].v==='!'))){neg=!neg;ts=ts.slice(1);}
    if(!ts.length) throw new Error('missing condition');
    if(ts[0].v==='('&&ts[ts.length-1].v===')'&&balanced(ts)){var r0=condEval(ts.slice(1,-1),L,st);return {val:neg?!r0.val:r0.val,sum:(neg?'¬':'')+'('+r0.sum+')'};}
    var r=H.assert(L,ts,st,decide(stateText(ts))), val, sum;   // 檢查句的說法：in / is empty / == …（Jev 判斷有沒有「不」）
    if(r&&typeof r.check==='boolean'){val=r.check;sum=r.sum;}
    else {var xs=exprToks(ts,0,null,true), v=evaluate(xs,st); val=truthy(v); sum=xs.map(function(t){return t.k==='comp'&&(t.c.type==='var'||t.c.type==='pointer')?fmt(compValue(t.c)):t.k==='str'?'"'+t.v+'"':t.k==='comp'?t.c.name:t.v;}).join(' ');}
    return {val:neg?!val:val,sum:(neg?'¬ ':'')+sum};
  }
  function condEval(ts,L,st){
    var ors=splitTop(ts,isOr), sums=[], val=false;
    for(var i=0;i<ors.length&&!val;i++){
      var ands=splitTop(ors[i],isAnd), as=[], av=true;
      for(var j=0;j<ands.length;j++){var r=condOne(ands[j],L,st); as.push(r.sum); if(!r.val){av=false;break;}}
      sums.push(as.join(' ∧ ')); val=av;}
    return {val:val,sum:sums.join(' ∨ ')};
  }
  function condText(text,L,st){
    var t=half(text).replace(/\s*(?:並且|并且|而且)\s*/g,' and ').replace(/\s*(?:或者|或)\s*/g,' or ');
    var ts=tag(lex(t),st); if(!ts.length) throw new Error('missing condition');
    return condEval(ts,L,st);
  }

  /* ---------- for 迴圈：每一輪要設哪些變數 ---------- */
  var STRUCT={in:1,over:1,across:1,range:1,enumerate:1,each:1,of:1,from:1,to:1,through:1};
  var LOOPKINDS={ // Jev 的選擇題：這個 for 是哪一種？
    each:['ID in ARR','each ID in ARR','ID in STRG','each ID in STRG','ID in STK','ID in QUE','ID in SET','ID in MAP','ID in LIST','ID in STR','ID , ID in MAP','ID in MAP . items ( )'],
    index:['PTR in ARR','PTR in STRG','ID over ARR','ID across ARR','index ID of ARR','each index ID in ARR','PTR over ARR','ID over STRG'],
    range:['ID in range ( NUM )','ID in range ( NUM , NUM )','ID in range ( len ( ARR ) )','ID in range ( VAR )','ID from NUM to NUM','ID = NUM to NUM','PTR in range ( len ( ARR ) )'],
    enumerate:['ID , ID in enumerate ( ARR )','ID , ID in enumerate ( STRG )','PTR , ID in enumerate ( ARR )','ID , VAR in enumerate ( ARR )']
  };
  QSETS.loop.loop.criteria=LOOPKINDS;
  function normFor(head){ // 中文標題先換成英文的說法
    return half(head).replace(/\s*(?:裡|里|中)\s*$/,'').replace(/\s*在\s*/g,' in ').replace(/\s*[從从]\s*/g,' from ').replace(/\s*(?:到|至)\s*/g,' to ').replace(/^\s*each\s+/,'each ').trim();
  }
  function nameOf(t,src){return t.k==='comp'?t.c.name:src.slice(t.s,t.e);}
  function loopVar(st,tok,key,L,arr,src){ // 第一次跑建立元件（屬於這一行），之後每輪只改值
    var name=nameOf(tok,src);
    return function(v){
      var c=st.byName[name];
      if(!c){
        if(arr){c=blank('pointer',key,L.id,name);c.target=arr.key;c.color=[2,1,3,4][st.ptrColor++%4];c.idx=0;}
        else c=blank('var',key,L.id,name);
        c.loopVar=true; addComp(st,c);
      }
      if(c.type==='pointer'){c.idx=v; var a=keyed(st,c.target); st.events.push({t:'move',ptr:name,arr:a?a.name:null,idx:v,line:L.id});}
      else if(c.type==='var') c.value=fmt(v);
      else throw new Error('"'+name+'" is a '+c.type+' on the board, it cannot be a loop variable');
    };
  }
  function planFor(nd,st){
    var src=normFor(nd.head), L={id:nd.L.id,text:nd.head}, key=nd.L.id, toks=tag(lex(src),st), state=stateText(toks);
    var t=toks.slice(); while(t.length&&t[0].k==='word'&&t[0].v==='each') t.shift();
    var usage='Try "for x in nums", "for i in range(n)", "for i, x in enumerate(nums)" or "for i over nums"';
    if(!t.length) throw new Error('loop over what? '+usage);
    var idxMode=false;
    if(t[0].k==='word'&&t[0].v==='index'&&t[1]&&!(t[1].k==='word'&&STRUCT[t[1].v])&&t.some(function(x){return x.k==='word'&&(x.v==='of'||x.v==='in');})){idxMode=true;t.shift();}
    var di=-1;
    for(var i=0;i<t.length&&di<0;i++){var x=t[i];
      if((x.k==='word'&&(x.v==='in'||x.v==='over'||x.v==='across'||x.v==='from'||(idxMode&&x.v==='of')))||(x.k==='sym'&&x.v==='=')) di=i;}
    if(di<1) throw new Error('did not understand the loop "'+nd.head+'". '+usage);
    var names=t.slice(0,di).filter(function(x){return !(x.k==='sym'&&x.v===',');}), div=t[di].v, rest=t.slice(di+1);
    if(!names.length||names.some(function(x){return !(x.k==='id'||x.k==='comp'||(x.k==='word'&&!STRUCT[x.v]));})) throw new Error('the loop variable must be a plain name. '+usage);
    var lk=decideLoop(state), pj=lk.probabilities[lk.choice], cf=lk.confidence;
    function nm(k){return nameOf(names[k],src);}
    function restText(r){return r.length?src.slice(r[0].s,r[r.length-1].e):'';}
    function arrOf(r){return r.length===1&&r[0].k==='comp'&&(r[0].c.type==='array'||r[0].c.type==='string')?r[0].c:null;}
    function ex(r){return evaluate(exprToks(r,0,null,true),st);}
    function whole(v,what){if(typeof v!=='number'||v!==Math.floor(v)) throw new Error(what+' must be a whole number, got '+fmt(v)); return v;}
    function plan(n,apply,label){return {n:n,apply:apply,label:label,p:pj,conf:cf};}
    function overPlan(arr){
      if(names.length!==1) throw new Error('one name please: for i over '+arr.name);
      var set=loopVar(st,names[0],key,L,arr,src);
      return plan(arr.cells.length,function(k){set(k);},function(k){return nm(0)+' → '+arr.name+'['+k+'] = '+arr.cells[k];});
    }
    function numPlan(vals){
      if(names.length!==1) throw new Error('one name please. '+usage);
      var set=loopVar(st,names[0],key,L,null,src);
      return plan(vals.length,function(k){set(vals[k]);},function(k){return nm(0)+' = '+vals[k];});
    }
    // for i over nums / for index i of nums：指標一格一格走過陣列
    if(div==='over'||div==='across'||idxMode){var a0=arrOf(rest); if(!a0) throw new Error('"'+restText(rest)+'" is not an array or string on the board'); return overPlan(a0);}
    // for i from 0 to 5
    if(div==='from'||div==='='){
      var ti=-1; rest.forEach(function(x,k){if(ti<0&&x.k==='word'&&(x.v==='to'||x.v==='through')) ti=k;});
      if(ti<1) throw new Error('missing "to", e.g. for i from 0 to 5');
      var A=whole(ex(rest.slice(0,ti)),'the start'), Z=whole(ex(rest.slice(ti+1)),'the end'), vals=[], dd=A<=Z?1:-1;
      for(var v=A;dd>0?v<=Z:v>=Z;v+=dd){vals.push(v); if(vals.length>LIMIT_LOOP) throw new Error('more than '+LIMIT_LOOP+' rounds');}
      return numPlan(vals);
    }
    // for i in range(n) / range(a, b) / range(a, b, step)
    if(rest.length&&rest[0].k==='word'&&rest[0].v==='range'){
      if(!(rest[1]&&rest[1].v==='('&&rest[rest.length-1].v===')')) throw new Error('range needs brackets: range(n) or range(a, b)');
      var args=splitTop(rest.slice(2,-1),function(y){return y.k==='sym'&&y.v===',';}).map(function(a){return whole(ex(a),'range()');}), a1=0, b1, s1=1;
      if(args.length===1) b1=args[0]; else {a1=args[0];b1=args[1]; if(args.length>2) s1=args[2];}
      if(!s1) throw new Error('the range step cannot be 0');
      var vals2=[]; for(var v2=a1;s1>0?v2<b1:v2>b1;v2+=s1){vals2.push(v2); if(vals2.length>LIMIT_LOOP) throw new Error('more than '+LIMIT_LOOP+' rounds');}
      return numPlan(vals2);
    }
    // for i, x in enumerate(nums)
    if(rest.length&&rest[0].k==='word'&&rest[0].v==='enumerate'){
      if(names.length!==2) throw new Error('enumerate gives two names: for i, x in enumerate(nums)');
      if(!(rest[1]&&rest[1].v==='('&&rest[rest.length-1].v===')')) throw new Error('enumerate needs brackets: enumerate(nums)');
      var a2=arrOf(rest.slice(2,-1)); if(!a2) throw new Error('enumerate(…) needs an array or string that is on the board');
      var vals3=compValue(a2), setI=loopVar(st,names[0],key,L,a2,src), setV=loopVar(st,names[1],key+'#1',L,null,src);
      return plan(vals3.length,function(k){setI(k);setV(vals3[k]);},function(k){return nm(0)+' = '+k+', '+nm(1)+' = '+fmt(vals3[k]);});
    }
    // for x in nums / for k, v in seen / for k, v in seen.items() / for p in i（指標＋陣列）
    var suffix=null, r2=rest;
    if(r2.length>=5){var tail=r2.slice(-4); if(tail[0].v==='.'&&tail[2].v==='('&&tail[3].v===')'&&/^(items|keys|values)$/i.test(String(tail[1].v))){suffix=String(tail[1].v).toLowerCase();r2=r2.slice(0,-4);}}
    var single=arrOf(r2);
    if(names.length===1&&names[0].k==='comp'&&names[0].c.type==='pointer'&&single&&!suffix) return overPlan(single); // 已經有的指標 in 陣列 → 走索引
    var val=ex(r2), isMap=val&&typeof val==='object'&&!Array.isArray(val);
    if(names.length===2){
      if(!isMap) throw new Error('two names need a dict: for k, v in seen (for an array use enumerate)');
      var ks=Object.keys(val), s1v=loopVar(st,names[0],key,L,null,src), s2v=loopVar(st,names[1],key+'#1',L,null,src);
      return plan(ks.length,function(k){s1v(ks[k]);s2v(val[ks[k]]);},function(k){return nm(0)+' = '+ks[k]+', '+nm(1)+' = '+fmt(val[ks[k]]);});
    }
    if(names.length!==1) throw new Error('one name per loop, or enumerate(...) for index and value');
    var items;
    if(Array.isArray(val)) items=val.slice();
    else if(typeof val==='string') items=val.split('').map(num);
    else if(isMap){items=Object.keys(val); if(suffix==='values') items=items.map(function(k){return val[k];});}
    else throw new Error('cannot loop over '+fmt(val));
    var setX=loopVar(st,names[0],key,L,null,src);
    return plan(items.length,function(k){setX(items[k]);},function(k){return nm(0)+' = '+fmt(items[k]);});
  }

  /* ---------- 跑整份腳本 ---------- */
  var RANK={ok:1,pass:2,fail:3,err:4};
  /* lines: [{id,text}]；step：第幾步（含）為止的板子（每執行一行算一步），null＝全部。回傳 trace＝每一步 */
  function replay(lines,step){
    var st=newState(), prog=parseProgram(lines), trace=[], agg={}, halted=false, STOP={};
    var at=step!=null&&step<0?newState():null;
    function note(nd,res){
      res.n=nd.i; res.id=nd.L.id; trace.push(res);
      var cur=agg[nd.i], rk=RANK[res.status]||0;
      if(!cur){cur=agg[nd.i]={}; for(var k in res)cur[k]=res[k]; cur.runs=1;}
      else {var r0=cur.runs+1; if(rk>=(RANK[cur.status]||0)) for(var k2 in res)cur[k2]=res[k2]; cur.runs=r0;}
      if(step!=null&&trace.length-1===step) at=cloneState(st);
      if(trace.length>=LIMIT_STEPS) throw STOP;
    }
    function okStep(nd,intent,sum,extra){var r={status:'ok',intent:intent,sum:sum,msg:'',p:1,confidence:1,state:''}; if(extra)for(var k in extra)r[k]=extra[k]; note(nd,r);}
    function errStep(nd,msg,intent){note(nd,{status:'err',intent:intent||'flow',sum:'',msg:msg,p:1,confidence:1,state:''});}
    function stmt(nd){
      var res=runLine({id:nd.L.id,text:nd.text},st); note(nd,res);
      if(res.intent==='ret'&&res.status!=='err'){halted=true;return 'return';}
      return null;
    }
    function runFor(nd){
      var plan; try{plan=planFor(nd,st);}catch(e){errStep(nd,e.message,'loop');return null;}
      if(!plan.n){okStep(nd,'loop','nothing to loop over (0 rounds)',{of:0});return null;}
      for(var k=0;k<plan.n;k++){
        try{plan.apply(k);}catch(e){errStep(nd,e.message,'loop');return null;}
        okStep(nd,'loop',plan.label(k)+'   ('+(k+1)+'/'+plan.n+')',{iter:k+1,of:plan.n,p:plan.p,confidence:plan.conf});
        var sig=runBlock(nd.body,true);
        if(sig==='return') return 'return';
        if(sig==='break') break;
      }
      return null;
    }
    function runRepeat(nd){
      var n; try{n=evaluate(exprToks(tag(lex(half(nd.head).replace(/\s*(?:times|time|次)\s*$/i,'')),st),0,null,true),st);}catch(e){errStep(nd,e.message,'loop');return null;}
      if(typeof n!=='number'||n!==Math.floor(n)||n<0||n>LIMIT_LOOP){errStep(nd,'repeat needs a whole number from 0 to '+LIMIT_LOOP+', got '+fmt(n),'loop');return null;}
      for(var k=0;k<n;k++){
        okStep(nd,'loop','round '+(k+1)+' of '+n,{iter:k+1,of:n});
        var sig=runBlock(nd.body,true);
        if(sig==='return') return 'return';
        if(sig==='break') break;
      }
      if(!n) okStep(nd,'loop','0 rounds',{of:0});
      return null;
    }
    function runWhile(nd){
      for(var k=0;;k++){
        if(k>=LIMIT_LOOP){errStep(nd,'ran more than '+LIMIT_LOOP+' rounds: does something in the loop change the condition?','loop');return null;}
        var r; try{r=condText(nd.head,{id:nd.L.id,text:nd.head},st);}catch(e){errStep(nd,e.message,'loop');return null;}
        okStep(nd,'loop',r.sum+(r.val?'   →  yes':'   →  no'),{iter:k+1});
        if(!r.val) return null;
        var sig=runBlock(nd.body,true);
        if(sig==='return') return 'return';
        if(sig==='break') return null;
      }
    }
    function runBlock(list,inLoop){
      var chain=null; // null：前面沒有 if；'open'：前面的條件都沒成立；'done'：已經有一個分支跑過了
      for(var k=0;k<list.length;k++){
        var nd=list[k], sig=null;
        if(halted) return 'return';
        st.cur=nd.L.id;
        switch(nd.kind){
          case 'if': case 'elif': case 'else':
            if(nd.kind==='if') chain=null;
            if(nd.kind!=='if'&&chain==null){errStep(nd,nd.kind+' has no matching if above it','branch');break;}
            if(nd.kind!=='if'&&chain==='done') break;               // 前面已經有分支跑過：這一行沒跑到
            if(nd.kind==='else'){okStep(nd,'else','otherwise');chain=null;sig=runBlock(nd.body,inLoop);break;}
            var r; try{r=condText(nd.head,{id:nd.L.id,text:nd.head},st);}catch(e){errStep(nd,e.message,'branch');chain='done';break;}
            okStep(nd,'branch',r.sum+(r.val?'   →  yes':'   →  no'));
            chain=r.val?'done':'open'; if(r.val) sig=runBlock(nd.body,inLoop);
            break;
          case 'for': chain=null; sig=runFor(nd); break;
          case 'while': chain=null; sig=runWhile(nd); break;
          case 'repeat': chain=null; sig=runRepeat(nd); break;
          case 'break': case 'continue':
            chain=null;
            if(!inLoop){errStep(nd,nd.kind+' only works inside a loop');break;}
            okStep(nd,nd.kind,nd.kind); sig=nd.kind; break;
          default: chain=null; sig=stmt(nd);
        }
        if(sig) return sig;
      }
      return null;
    }
    try{runBlock(prog.body,false);}
    catch(e){
      if(e!==STOP) throw e;
      var last=trace[trace.length-1]; if(last&&agg[last.n]){agg[last.n].status='err'; agg[last.n].msg='stopped after '+LIMIT_STEPS+' steps: is there an endless loop?';}
    }
    var results=lines.map(function(L,i){
      if(prog.stat[i]) return {id:L.id,n:i,status:prog.stat[i]};
      var a=agg[i]; if(a){a.id=L.id;a.n=i;return a;}
      return {id:L.id,n:i,status:'skip',intent:null,sum:'',msg:'',runs:0};
    });
    return {results:results,state:st,board:step!=null&&at?at:st,trace:trace};
  }
  return {replay:replay,prime:prime,runLine:runLine,normFor:normFor,flowOf:flowOf,parseProgram:parseProgram,hasFlow:hasFlow,lex:lex,tag:tag,stateText:stateText,evaluate:evaluate,fmt:fmt,num:num,same:same,newState:newState,decide:decide,TAG:TAG};
})(typeof Jev!=='undefined'?Jev:require('./jev.js'));
if(typeof module!=='undefined'&&module.exports) module.exports=NLBoard;
