/* Trainer — LeetCode practice on top of an NLBoard script.
 *
 *  1. describe: the script builds the board (NLBoard + Jev)
 *  2. trace:    step through the script; check() replays a reference solution on
 *               the inputs that are on the board and compares it with the trace
 *  3. go:       goCode() turns the board into a Go skeleton (or the reference
 *               solution) plus a table test that includes the traced example
 */
var Trainer=(function(NL){
  var fmt=NL.fmt;
  function ints(c){if(!c||!c.cells)return null;var v=c.cells.map(function(x){return /^-?\d+$/.test(x)?+x:NaN;});return v.some(isNaN)?null:v;}
  function find(st,types,name){var cs=st.comps.filter(function(c){return types.indexOf(c.type)>=0;});return cs.filter(function(c){return c.name===name;})[0]||cs[0]||null;}
  function moves(st,arr){var out=[];st.events.forEach(function(e){if(e.t==='move'&&e.arr===arr&&(out.length===0||out[out.length-1].idx!==e.idx))out.push(e);});return out;}
  function sorted(a){return Array.isArray(a)?a.slice().sort(function(x,y){return x-y;}):a;}
  function goStr(s){return JSON.stringify(s);}

  var CASES={};
  CASES['two-sum']={
    id:1, slug:'two-sum', title:'Two Sum',
    inputs:function(st){
      var arr=find(st,['array'],'nums'), nums=ints(arr), t=st.byName.target;
      if(!nums) return {err:'need an int array (e.g. "array nums = [2,7,11,15]")'};
      if(!t||t.type!=='var'||!/^-?\d+$/.test(t.value)) return {err:'need a variable target (e.g. "variable target = 9")'};
      return {nums:nums,target:+t.value,arr:arr.name};
    },
    solve:function(inp){
      var seen={}, visits=[], steps=[];
      for(var i=0;i<inp.nums.length;i++){
        visits.push(i); var x=inp.nums[i], need=inp.target-x;
        if(String(need) in seen){steps.push({i:i,x:x,need:need,hit:true});return {answer:[seen[need],i],visits:visits,seen:Object.assign({},seen),steps:steps};}
        steps.push({i:i,x:x,need:need,hit:false}); seen[x]=i;
      }
      return {answer:null,visits:visits,seen:seen,steps:steps};
    },
    demo:function(inp){
      var ref=this.solve(inp), L=['title: 1. Two Sum (target = '+inp.target+')','array nums = ['+inp.nums.join(', ')+']','variable target = '+inp.target,'dict seen','pointer i at nums[0]'];
      ref.steps.forEach(function(s,k){
        if(k) L.push('move i to '+s.i);
        L.push('x = nums[i]','need = target - x');
        if(s.hit) L.push('need '+s.need+' is in seen','return [seen[need], i]');
        else L.push('need '+s.need+' is not in seen','put x -> i into seen');
      });
      return L;
    },
    compare:function(ref,st,inp,out){
      var mv=moves(st,inp.arr).map(function(e){return e.idx;});
      if(mv.length){
        var bad=-1; for(var k=0;k<mv.length;k++) if(mv[k]!==ref.visits[k]){bad=k;break;}
        out.push(bad<0?{ok:true,msg:'pointer path '+fmt(mv)+' matches the one-pass scan'}:{ok:false,msg:'pointer path '+fmt(mv)+' differs from the scan '+fmt(ref.visits)+' at step '+bad});
      }
      var d=st.comps.filter(function(c){return c.type==='dict';})[0];
      if(d){var mine={};d.rows.forEach(function(r){mine[r[0]]=r[1];});
        var ok=fmt(mine)===fmt(ref.seen);
        out.push({ok:ok,msg:ok?'dict '+d.name+' = '+fmt(mine)+' matches':'dict '+d.name+' is '+fmt(mine)+', the reference has '+fmt(ref.seen)+' when it answers'});}
    },
    sameAnswer:function(a,b){return Array.isArray(a)&&Array.isArray(b)&&fmt(sorted(a))===fmt(sorted(b));},
    go:{
      fn:'twoSum', sig:'func twoSum(nums []int, target int) []int', params:['nums','target'], zero:'nil',
      solution:['seen := map[int]int{}','for i, x := range nums {','\tif j, ok := seen[target-x]; ok {','\t\treturn []int{j, i}','\t}','\tseen[x] = i','}','return nil'],
      tests:[{nums:[3,2,4],target:6,want:[1,2]},{nums:[3,3],target:6,want:[0,1]}],
      fields:['nums []int','target int','want []int'],
      lit:function(t){return '{'+['[]int{'+t.nums.join(', ')+'}',t.target,t.want?'[]int{'+t.want.join(', ')+'}':'nil'].join(', ')+'}';},
      call:'got := twoSum(append([]int(nil), c.nums...), c.target)',
      check:['sort.Ints(got)','want := append([]int(nil), c.want...)','sort.Ints(want)','if !reflect.DeepEqual(got, want) {','\tt.Errorf("twoSum(%v, %d) = %v, want %v", c.nums, c.target, got, c.want)','}'],
      imports:['reflect','sort','testing']
    }
  };
  var PAIR={')':'(',']':'[','}':'{'};
  CASES['valid-parentheses']={
    id:20, slug:'valid-parentheses', title:'Valid Parentheses',
    inputs:function(st){
      var s=find(st,['string','array'],'s');
      if(!s||!s.cells.length||s.cells.some(function(c){return '()[]{}'.indexOf(c)<0||c.length!==1;})) return {err:'need a string of brackets (e.g. s = "([)]")'};
      return {s:s.cells.join(''),str:s.name};
    },
    solve:function(inp){
      var st=[], ops=[], steps=[];
      for(var i=0;i<inp.s.length;i++){var c=inp.s[i];
        if(!PAIR[c]){st.push(c);ops.push({t:'push',v:c});steps.push({i:i,c:c,push:true});continue;}
        if(!st.length){steps.push({i:i,c:c,empty:true});return {answer:false,ops:ops,steps:steps};}
        var top=st.pop(); ops.push({t:'pop',v:top});
        if(top!==PAIR[c]){steps.push({i:i,c:c,pop:top,bad:true});return {answer:false,ops:ops,steps:steps};}
        steps.push({i:i,c:c,pop:top});
      }
      steps.push({end:true,left:st.length});
      return {answer:st.length===0,ops:ops,steps:steps};
    },
    demo:function(inp){
      var ref=this.solve(inp), L=['title: 20. Valid Parentheses','s = '+goStr(inp.s),'stack st','pointer i at s[0]'];
      ref.steps.forEach(function(s,k){
        if(s.end){L.push(s.left?'st is not empty':'st is empty','return '+(s.left?'false':'true'));return;}
        if(k) L.push('move i to '+s.i);
        L.push('c = s[i]');
        if(s.push) L.push('push c onto st');
        else if(s.empty) L.push('st is empty','return false');
        else {L.push('pop '+goStr(s.pop)+' from st'); if(s.bad) L.push('# '+s.c+' does not close '+s.pop,'return false');}
      });
      return L;
    },
    compare:function(ref,st,inp,out){
      var stk=st.comps.filter(function(c){return c.type==='stack';})[0]; if(!stk) return;
      var mine=st.events.filter(function(e){return (e.t==='push'||e.t==='pop')&&e.box===stk.name;}).map(function(e){return e.t+' '+e.v;});
      var want=ref.ops.map(function(o){return o.t+' '+o.v;}), bad=-1;
      for(var k=0;k<Math.max(mine.length,want.length);k++) if(mine[k]!==want[k]){bad=k;break;}
      out.push(bad<0?{ok:true,msg:'stack operations match ('+mine.length+')'}:{ok:false,msg:'stack op #'+(bad+1)+': you did "'+(mine[bad]||'nothing')+'", the reference does "'+(want[bad]||'nothing')+'"'});
    },
    sameAnswer:function(a,b){return a===b;},
    go:{
      fn:'isValid', sig:'func isValid(s string) bool', params:['s'], zero:'false',
      solution:['pair := map[byte]byte{\')\': \'(\', \']\': \'[\', \'}\': \'{\'}','st := []byte{}','for i := 0; i < len(s); i++ {','\tc := s[i]','\topen, closing := pair[c]','\tif !closing {','\t\tst = append(st, c)','\t\tcontinue','\t}',
        '\tif len(st) == 0 || st[len(st)-1] != open {','\t\treturn false','\t}','\tst = st[:len(st)-1]','}','return len(st) == 0'],
      tests:[{s:'()',want:true},{s:'()[]{}',want:true},{s:'(]',want:false},{s:'([)]',want:false},{s:'{[]}',want:true},{s:']',want:false}],
      fields:['s string','want bool'],
      lit:function(t){return '{'+goStr(t.s)+', '+t.want+'}';},
      call:'got := isValid(c.s)',
      check:['if got != c.want {','\tt.Errorf("isValid(%q) = %v, want %v", c.s, got, c.want)','}'],
      imports:['testing']
    }
  };
  function byPid(pid){for(var k in CASES)if(CASES[k].id===pid)return k;return null;}
  /* 沒選題目時，從標題猜：「title: 1. Two Sum」 */
  function guess(st){
    var t=st.comps.filter(function(c){return c.type==='title';}).map(function(c){return c.text;}).join(' ').toLowerCase();
    for(var k in CASES){var C=CASES[k]; if(new RegExp('(^|\\D)'+C.id+'\\s*\\.').test(t)||t.indexOf(C.title.toLowerCase())>=0||t.indexOf(C.slug)>=0) return k;}
    return null;
  }

  /* 對答案：輸入取自板子，參考解答跑一次，和你的追蹤比 */
  function check(caseId,run){
    var st=run.state, out=[]; caseId=caseId||guess(st); var C=CASES[caseId];
    var fails=run.results.filter(function(r){return r.status==='fail';}), errs=run.results.filter(function(r){return r.status==='err';});
    out.push(errs.length?{ok:false,msg:errs.length+' line(s) could not be put on the board',lines:errs.map(function(r){return r.id;})}:{ok:true,msg:'every line was understood'});
    var nChecks=run.results.filter(function(r){return r.status==='pass'||r.status==='fail';}).length;
    if(nChecks) out.push(fails.length?{ok:false,msg:fails.length+' of '+nChecks+' check line(s) disagree with the board',lines:fails.map(function(r){return r.id;})}:{ok:true,msg:'all '+nChecks+' check line(s) hold on the board'});
    if(!C){
      out.push(st.answer===undefined?{ok:false,msg:'no "return …" line yet'}:{ok:true,msg:'your answer: '+fmt(st.answer)});
      return {items:out,ok:out.every(function(x){return x.ok;})};
    }
    var inp=C.inputs(st);
    if(inp.err){out.push({ok:false,msg:inp.err});return {items:out,ok:false};}
    var ref=C.solve(inp);
    C.compare(ref,st,inp,out);
    if(st.answer===undefined) out.push({ok:false,msg:'no "return …" line yet; the reference answer is hidden until you return one'});
    else out.push(C.sameAnswer(st.answer,ref.answer)?{ok:true,msg:'answer '+fmt(st.answer)+' is correct'}:{ok:false,msg:'answer '+fmt(st.answer)+' is wrong; expected '+fmt(ref.answer)});
    return {items:out,ok:out.every(function(x){return x.ok;}),inputs:inp,ref:ref,caseId:caseId};
  }

  /* ---------- Go ---------- */
  function goType(vals,str){
    if(!vals.length) return str?'byte':'int';
    if(vals.every(function(v){return /^-?\d+$/.test(v);})) return 'int';
    if(vals.every(function(v){return v==='true'||v==='false';})) return 'bool';
    if(str&&vals.every(function(v){return v.length===1;})) return 'byte';
    return 'string';
  }
  function alignFields(fs){var w=Math.max.apply(null,fs.map(function(f){return f.split(' ')[0].length;}));return fs.map(function(f){var p=f.split(' ');return p[0]+Array(w-p[0].length+2).join(' ')+p.slice(1).join(' ');});}
  function goVal(v,t){return t==='int'||t==='bool'?v:t==='byte'?"'"+(v==='\''?'\\\'':v)+"'":goStr(v);}
  function decls(st,params,isStr){
    var D=[], used=[], loops=[];
    function put(code,note){if(note)D.push('// '+note);D.push(code);}
    st.comps.forEach(function(c){
      if(!c.name||params.indexOf(c.name)>=0||c.ret||c.type==='title'||c.type==='note') return;
      var n=c.name.replace(/\W/g,'_');
      if(c.type==='dict'){var kt=goType(c.rows.map(function(r){return r[0];}),isStr),vt=goType(c.rows.map(function(r){return r[1];}),isStr);put(n+' := map['+kt+']'+vt+'{}','dict "'+c.name+'" on your board');used.push(n);}
      else if(c.type==='set'){put(n+' := map['+goType(c.cells,isStr)+']bool{}','set "'+c.name+'" on your board');used.push(n);}
      else if(c.type==='stack'||c.type==='queue'){put(n+' := []'+goType(c.cells,isStr)+'{}',c.type+' "'+c.name+'"'+(c.type==='stack'?': push = append, pop = '+n+'[:len('+n+')-1]':': pop front = '+n+'[1:]'));used.push(n);}
      else if(c.type==='array'||c.type==='string'){var t=goType(c.cells,c.type==='string');put(n+' := []'+t+'{'+c.cells.map(function(v){return goVal(v,t);}).join(', ')+'}');used.push(n);}
      else if(c.type==='pointer'){var a=st.comps.filter(function(x){return x.key===c.target;})[0]; loops.push({n:n,over:a?a.name:null});}
      else if(c.type==='var'){var vt2=goType([c.value],isStr);put('var '+n+' '+vt2,c.name+' = '+c.value+' at the end of your trace');used.push(n);}
    });
    return {D:D,used:used,loops:loops};
  }
  function goCode(caseId,run,lines,opts){
    opts=opts||{}; var st=run.state; caseId=caseId||guess(st); var C=CASES[caseId];
    var trace=lines.filter(function(l){return l.text.trim();}).map(function(l){return '//\t'+l.text.trim();});
    if(!C){
      var d0=decls(st,[],false), body=d0.D.concat(d0.used.map(function(n){return '_ = '+n;}));
      return {'solution.go':['package solution','','// Whiteboard trace:','//'].concat(trace,['func solve() {'],body.map(function(x){return '\t'+x;}),['}','']).join('\n'),
              'solution_test.go':['package solution','','import "testing"','','func TestSolve(t *testing.T) {','\tsolve() // TODO: compare with the answer you traced: '+fmt(st.answer),'}',''].join('\n')};
    }
    var G=C.go, inp=C.inputs(st), body2;
    if(opts.solution) body2=G.solution;
    else {
      var d=decls(st,G.params,caseId==='valid-parentheses');
      body2=d.D.slice();
      d.loops.forEach(function(l){
        if(l.over&&G.params.indexOf(l.over)>=0) body2.push('// pointer "'+l.n+'" walks '+l.over,'for '+l.n+' := 0; '+l.n+' < len('+l.over+'); '+l.n+'++ {','\t_ = '+l.n,'\t// TODO: one iteration of your trace','}');
        else {body2.push('// pointer "'+l.n+'"','var '+l.n+' int');d.used.push(l.n);}
      });
      G.params.forEach(function(p){d.used.push(p);});
      body2=body2.concat(d.used.map(function(n){return '_ = '+n;}),['// TODO: write the loop body from your trace','return '+G.zero]);
    }
    var cases=[];
    if(!inp.err){var ref=C.solve(inp), ex=Object.assign({},inp,{want:ref.answer});
      cases.push('\t\t'+G.lit(ex)+', // traced on your whiteboard'+(st.answer!==undefined&&!C.sameAnswer(st.answer,ref.answer)?' (your trace said '+fmt(st.answer)+')':''));}
    G.tests.forEach(function(t){cases.push('\t\t'+G.lit(t)+',');});
    var sol=['package solution','','// '+C.id+'. '+C.title+' — https://leetcode.com/problems/'+C.slug+'/','//','// Whiteboard trace:','//'].concat(trace,[G.sig+' {'],body2.map(function(x){return '\t'+x;}),['}','']).join('\n');
    var test=['package solution','','import (',G.imports.map(function(i){return '\t"'+i+'"';}).join('\n'),')','','func Test'+G.fn[0].toUpperCase()+G.fn.slice(1)+'(t *testing.T) {','\tcases := []struct {',alignFields(G.fields).map(function(f){return '\t\t'+f;}).join('\n'),'\t}{'].concat(cases,['\t}','\tfor _, c := range cases {','\t\t'+G.call],G.check.map(function(x){return '\t\t'+x;}),['\t}','}','']).join('\n');
    return {'solution.go':sol,'solution_test.go':test};
  }
  return {CASES:CASES,byPid:byPid,guess:guess,check:check,goCode:goCode,demo:function(caseId,inp){return CASES[caseId].demo(inp);}};
})(typeof NLBoard!=='undefined'?NLBoard:require('./nlboard.js'));
if(typeof module!=='undefined'&&module.exports) module.exports=Trainer;
