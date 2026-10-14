/** Word lists shared by the checks and the whole-manuscript review. */

// Function ("glue") words: a sentence made mostly of these is "sticky".
export const GLUE: ReadonlySet<string> = new Set(
  (
    'a,about,above,after,again,against,all,also,am,an,and,any,are,as,at,be,because,been,before,being,below,between,both,but,by,can,could,did,do,does,doing,down,during,each,since,' +
    'even,ever,every,few,for,from,further,get,got,had,has,have,having,he,her,here,hers,herself,him,himself,his,how,i,if,in,into,is,it,its,itself,just,like,me,might,more,most,' +
    'much,must,my,myself,no,nor,not,now,of,off,on,once,one,only,or,other,our,ours,ourselves,out,over,own,quite,rather,really,same,she,should,so,some,such,than,that,the,their,' +
    'theirs,them,themselves,then,there,these,they,thing,things,this,those,though,through,to,too,under,until,up,upon,us,very,was,we,well,were,what,when,where,which,while,who,' +
    'whom,why,will,with,would,yet,you,your,yours,yourself,yourselves,still,back,way,around,maybe,something,anything,nothing,everything,someone,anyone,actually,basically,' +
    'simply,totally,literally,somehow,seemed,seem,seems,going,gonna,lot,kind,sort'
  ).split(','),
);
