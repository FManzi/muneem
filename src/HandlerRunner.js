const logger = require("./fakeLogger");

Runner.prototype.run = async function(asked,answer){
    this.runBefore(asked);
    
    logger.log.debug("Request" + asked.id + "Executing handler " + this.handlerName);
    await this.handler(asked,answer);
    
    this.runAfter(asked);
}


Runner.prototype.runBefore = function(asked) {
    if(this.before){
        logger.log.debug(asked,"Executing before of " + this.handlerName);
        callAll(this.before,asked,this.handlerName);
    }
}

Runner.prototype.runAfter = function(asked) {
    if(this.after){
        logger.log.debug(asked,"Executing after of " + this.handlerName);
        callAll(this.after,asked,this.handlerName);
    }
}

/**
 * 
 * @param {Array} arrayOfFunctions 
 */
function callAll(arrayOfFunctions, ...args){
    for(let i=0; i < arrayOfFunctions.length; i++){
        arrayOfFunctions[i](...args);
    }
}

/**
 * 
 * @param {*} handler 
 * @param {Array} before 
 * @param {Array} after 
 */
function Runner(name,handler,before,after){
    this.handlerName = name;
    this.handler = handler;
    if(!handler.inParallel){
        if(before && Array.isArray(before) && before.length > 0)
            this.before = before;
            
        if(after && Array.isArray(after) && after.length > 0)
            this.after = after;
    }
}

module.exports = Runner;