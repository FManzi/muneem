const YAML = require('yamljs');
const fs = require('fs');
const path = require('path');
var HttpAsked = require('./HttpAsked');
const HttpAnswer = require('./HttpAnswer');
const logger = require("./fakeLogger");
const ApplicationSetupError = require('./ApplicationSetupError');
const profile = process.env.NODE_ENV;

function checkPath(filepath){
    if (!fs.existsSync(filepath)) {
        throw new ApplicationSetupError("Path for mapping files/folder should either be absolute or relative to project directory: " + filepath);
    }
}

RoutesManager.prototype.addRoutesFromMappingsFile = function(filepath){
    checkPath(filepath);
    if(fs.lstatSync(filepath).isDirectory()){
        const files = fs.readdirSync(filepath);
        for(let index in files){
            const fPath = path.join(filepath,files[index]);
            if(!fs.lstatSync(fPath).isDirectory() && fPath.endsWith(".yaml")){
                const routes = readRoutesFromFile(fPath);
                logger.log.info("reading "+ (routes && routes.length) +" routes from file " + fPath);
                routes && this.addRoutes(routes);
            }
        }
    }else{
        const routes = readRoutesFromFile(filepath);
        logger.log.info("reading "+ (routes && routes.length) +" routes from file " + filepath);
        routes && this.addRoutes(routes);
    }

    /* if(this.router.count === 0){
        throw new ApplicationSetupError("There is no route exist. Please check the mapping file or add them from the code.");
    }else{
        logger.log.info(this.router.count + " routes are loaded.");
    } */
}

/**
 * Read routes mapping from a yaml file
 * @param {string} filepath 
 */
function readRoutesFromFile(filepath){
    try{
        return YAML.parseFile(filepath);
    }catch(e){
        logger.log.error( filepath + " is an invalid Yaml file or have syntatx issues.");
        logger.log.error( e);
    }
}

/**
 * Iterate through routes and add them
 * @param {Array} routes
 */
RoutesManager.prototype.addRoutes = function(routes){
    for(let index=0;index<routes.length;index++){
        this.addRoute(routes[index].route);
    }
}

const dontHaveBody = ["GET", "HEAD"]
const mayHaveBody = ["POST", "PUT", "DELETE", "OPTION"]

/**
 * Check a route mapping against the handlers added to muneem container.
 * Create routes with necessary handlers' calls
 * @param {object} route
 */
RoutesManager.prototype.addRoute = function(route){
    const THIS = this;
    if(route.in && route.in.indexOf(profile) === -1) return; //skip mapping for other environments
    const context = {
        app: this.appContext,
        route: route
    };
    route.when = route.when || "GET";//set default
    route.maxLength = route.maxLength || 1e6; //set 1mb default

    const routeHandlers = this.extractHandlersFromRoute(route);

    //read request body when there is at least one handler to handle it
    let handlerToReadBodyPresents = routeHandlers.reqDataStreamHandler || routeHandlers.reqDataHandlers.length > 0 
            || (routeHandlers.mainHandler && routeHandlers.mainHandler.type === "requestData");

    const bigBodyAlert = this.handlers.get("__exceedContentLength").handle;

    this.router.on(route.when,route.uri, function(nativeRequest,nativeResponse,params){

        const ans = new HttpAnswer(nativeResponse);
        const asked = new HttpAsked(nativeRequest,params);

        nativeRequest.on('error', function(err) {
            ans.error = err;
            THIS.handlersrs.get("__error").handle(asked,ans);
        });

        try{
            logger.log.debug(asked," matched with ", route);
            
            //operation on request stream
            //callAll(THIS.beforeAllPreHandlers,asked);
            for(let i=0; i<routeHandlers.reqHandlers.length;i++){
                logger.log.debug(asked,"Executing request handlers");
                //if(routeHandlers.reqHandlers[i].inParallel !== true)  callAll(THIS.beforeEachPreHandler,asked,routeHandlers.reqHandlers[i].name);
                routeHandlers.reqHandlers[i].handle(asked ,ans, context);
                //callAll(THIS.afterEachPreHandler,asked,routeHandlers.reqHandlers[i].name);
                if(ans.answered())  return;
            }

            logger.log.debug(asked,"Executing request handler");
            
            //if(context.route.to === routeHandlers.reqDataStreamHandler.name){
                //callAll(THIS.afterAllPreHandlersrs,asked,context.route.to);
                //callAll(THIS.beforeMainHandler,asked,context.route.to);
            //}else{
                //callAll(THIS.beforeEachPreHandler,asked,routeHandlers.reqDataStreamHandler.name);
            //}

            if(handlerToReadBodyPresents){
                if(routeHandlers.reqDataStreamHandler && routeHandlers.reqDataStreamHandler.before){
                    routeHandlers.reqDataStreamHandler.before(asked,ans, context);
                    if(ans.answered()) asked.nativeRequest.removeAllListeners();
                }
                readRequestBody(asked, ans, routeHandlers, context, bigBodyAlert);
                nativeRequest.on('end', function() {

                    if(routeHandlers.reqDataStreamHandler && routeHandlers.reqDataStreamHandler.after){
                        logger.log.debug(asked,"Executing request data stream handler after()");
                        routeHandlers.reqDataStreamHandler.after(asked,ans, context);
                
                        if(context.route.to === routeHandlers.reqDataStreamHandler.name){
                            //callAll(THIS.afterMainHandler,asked,context.route.to);
                        }else{
                            //callAll(THIS.afterEachPreHandler,asked,routeHandlers.reqDataStreamHandler.name);
                        }
                
                        if(ans.answered())  return;
                    }else{
                        //TODO: ask user if he wants buffer or string
                        asked.body = asked.body || Buffer.concat(asked.body);
                        logger.log.debug(asked,"Payload size: " + asked.body.length);
                    }

                    //operation on request body
                    logger.log.debug(asked,"Executing request data handlers");
                    for(let i=0; i<routeHandlers.reqDataHandlers.length;i++){
                        //callAll(THIS.beforeEachPreHandler,asked,routeHandlers.reqDataHandlers[i].name);
                        routeHandlers.reqDataHandlers[i].handle(asked ,ans, context);
                        //callAll(THIS.afterEachPreHandler,asked,routeHandlers.reqDataHandlers[i].name);
                        if(ans.answered())  return;
                    }
                    //callAll(THIS.afterAllPreHandlers,asked,context.route.to);

                    atEnd(asked,ans,routeHandlers,context)
                })
            }else{
                atEnd(asked,ans,routeHandlers,context)
            }
            
        }catch(e){
            ans.error = e;
            ans.context = context;
            THIS.handlers.get("__error").handle(asked,ans);
            //console.log(e)
        }
    })//router.on ends
}

/**
 * execute main handler and response/post handlers
 * @param {*} asked : request wrapper
 * @param {*} ans  : response wrapper
 * @param {*} routeHandlers : handlers attached to this route
 * @param {*} context : combination of app options and route mapping
 */
function atEnd(asked,ans,routeHandlers,context){
    
    if(routeHandlers.mainHandler) {
        logger.log.debug(asked,"Executing route.to");
        //callAll(THIS.beforeMainHandler,asked,context.route.to);
        routeHandlers.mainHandler.handle(asked,ans, context);
        //callAll(THIS.afterMainHandler,asked,context.route.to);
        if(ans.answered()) return;
    }

    //operation on respoonse
    logger.log.debug(asked,"Executing response handlers");
    for(let i=0; i<routeHandlers.resHandlers.length;i++){
        //callAll(THIS.beforeEachPostHandler,asked,routeHandlers.resHandlers[i].name);
        routeHandlers.resHandlers[i].handle(asked,ans, context);
        //callAll(THIS.afterEachPostHandler,asked,routeHandlers.resHandlers[i].name);
        if(ans.answered()) return;
    }

    if(!ans.answered()){//To confirm if some naughty postHandler has already answered
        if(ans.data && ans.data.pipe && typeof ans.data.pipe === "function"){//stream
            logger.log.debug(asked,"Responding back to client with stream");
            ans.data.pipe(nativeResponse);
        }else{
            if(ans.data !== undefined){
                if(typeof ans.data !== "string" && !Buffer.isBuffer(ans.data)){
                    logger.log.warn("Sorry!! Only string, buffer, or stream can be sent in response.");
                    logger.log.warn("Attempting JSON.stringify to transform Object to string");
                    ans.data = JSON.stringify(ans.data);
                }
            }
            ans.end();	
        }
    }

}

/**
 * If there is a stream handler attached to current route then call it on when request payload chunks are received.
 * If there is no stream handler and data handler then there is no need to read the request body
 * @param {*} nativeRequest 
 * @param {*} asked 
 * @param {*} ans 
 * @param {*} routeHandlers 
 */
const readRequestBody = function(asked, ans, routeHandlers, context, bigBodyAlert){

    /* const contentLen = asked.getHeader("content-length") || 0;
    const maxLength = contentLen > route.maxLength ? contentLen : route.maxLength ; */

    let streamHandler = routeHandlers.reqDataStreamHandler && routeHandlers.reqDataStreamHandler.handle || (chunk => { req.body.push(chunk)});
    let contentLength = 0;

    logger.log.debug(asked,"Before reading request payload/body");
    asked.nativeRequest.on('data', function(chunk) {
        if(contentLength < route.maxLength){
            contentLength += chunk.length;
            streamHandler(chunk);
        }else{
            //User may want to take multiple decisions instead of just refusing the request and closing the connection
            logger.log.debug(asked,"Calling __exceedContentLength handler");
            bigBodyAlert(asked,ans, context);
        }
    });

}

/**
 * Validate if the handlers sequence is correct. 
 * Find the handler's implementation against their name
 * @param {*} route 
 * @param {*} handlers 
 * @param {*} appContext 
 */
RoutesManager.prototype.extractHandlersFromRoute = function(route){
    const routeHandlers = {
        reqHandlers : [],
        reqDataStreamHandler: undefined,
        reqDataHandlers : [],
        resHandlers : [],
        mainHandler: undefined
    }

    //Prepare the list of handler need to be called before
    if(route.after){
        for(let i=0;i<route.after.length;i++){
            const handler = this.handlers.get(route.after[i]);
            if(!handler) throw new ApplicationSetupError("Unregistered handler " + route.after[i]);

            if(dontHaveBody[route.when] 
                && (handler.type === "requestDataStream" || handler.type === "requestData") 
                && !this.appContext.alwaysReadRequestPayload){
                throw new ApplicationSetupError("Set alwaysReadRequestPayload if you want to read request body/payload for GET and HEAD methods (which is not idle)");
            }

            if(handler.type === "requestDataStream"){
                if(routeHandlers.reqDataHandlers.length > 0){
                    throw new ApplicationSetupError("MappingError: Request Stream handler should be called before.");
                }else if(routeHandlers.reqDataStreamHandler){
                    throw new ApplicationSetupError("MappingError: There is only one request stream handler per mapping allowed.");
                }else{
                    routeHandlers.reqDataStreamHandler = handler;
                }
            }else if(handler.type === "requestData"){
                routeHandlers.reqDataHandlers.push(handler);
            }else/*   if(handler.type === "request") */{
                routeHandlers.reqHandlers.push(handler);
            }
        }
    }

    //Prepare the list of handler need to be called after
    if(route.then){
        for(let i=0;i<route.then.length;i++){
            const handler = this.handlers.get(route.then[i]);
            if(!handler) throw new ApplicationSetupError("Unregistered handler " + route.then[i]);
            else if(handler.type !== "response"){
                throw new ApplicationSetupError("Ah! wrong place for " + route.then[i] + ". Only response handlers are allowed here.");
            }
            routeHandlers.resHandlers.push(handler);
        }
    }

    if(route.to){
        const mainHandler = this.handlers.get(route.to);
        if(mainHandler.type === "requestDataStream"){
            if(routeHandlers.reqDataStreamHandler){
                throw new ApplicationSetupError("MappingError: There is only one request stream handler per mapping allowed.");
            }else{
                routeHandlers.reqDataStreamHandler = mainHandler;
                routeHandlers.mainHandler  = undefined;
            }
        }else{
            routeHandlers.mainHandler = mainHandler;
        }
    }
        
    return routeHandlers;
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

function RoutesManager(appContext,map){
    this.appContext = appContext;
    this.handlers = map;

    this.beforeAllPreHandlers = [], this.beforeEachPreHandler = [],  this.beforeMainHandler = [], this.beforeEachPostHandler = [], this.beforeAllPostHandlers = [];
    this.afterAllPreHandlers = [], this.afterEachPreHandler = [],  this.afterMainHandler = [], this.afterEachPostHandler = [], this.afterAllPostHandlers = [];

    //this.router = require('find-my-way')( {
    this.router = require('anumargak')( {
        ignoreTrailingSlash: true,
        //maxParamLength: appContext.maxParamLength || 100,
        defaultRoute : (nativeRequest,nativeResponse) =>{
            const answer = new HttpAnswer(nativeResponse);
            const asked = new HttpAsked(nativeRequest);
            map.get("__defaultRoute").handle(asked,answer);
        }
    } );
}
module.exports = RoutesManager;