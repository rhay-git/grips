/*! Handlebar.js (Simple Templating Engine)
	v0.0.1 (c) Kyle Simpson
	MIT License
*/

(function(global){
	var _Handlebar = global.Handlebar || null, _$HB = global.$HB || null;

	function orEmptyStr(val) {
		if (!val) return "";
		return val;
	}

	function templateURLsplit(src) {
		var parts = src.match(/^([^#]+)(#.*)?$/);
		return {"src":orEmptyStr(parts[1]),"id":orEmptyStr(parts[2])};
	}
	
	function quote_str(str) {
		str = str.replace(/\\/g,"\\\\") // escape all \ chars as \\
			.replace(/((\\\\)*)\"/g,"$1\\\"") // escape all ' chars that are not already escaped
			.replace(/\r/g,"\\r") // escape newlines
			.replace(/\n/g,"\\n") // escape newlines
		;		
		return str;
	}

	function engine() {
		var publicAPI,
			manifest,
			_util,
			_queue = [],
			_templates = {},
			_raw_masks = {},
			_check_queue = [],
			_manifest_loading = false
		;
		
		function init(manifest) {
			_util = publicAPI.Util;
			_manifest_loading = true;
			publicAPI.manifest = manifest || publicAPI.manifest || "templates.json";
			publicAPI.Loader.get(publicAPI.manifest,processManifest);
		}
		
		function mask_raw(raw,content) {
			var mask_template = "{$%_%$}", mask = "", tmp;
			
			while (mask == "") {
				tmp = mask_template.replace("_",Math.round(Math.random() * 100000000));
				if (typeof _raw_masks[tmp] === "undefined" && content.indexOf(tmp)<0) mask = tmp;
			}
			_raw_masks[mask] = raw.replace(/^\{\$%/,"").replace(/%\$\}$/,"");
			return mask;
		}
		
		function unmask_raw(content) {
			var masked_raw_regex = /\{\$%.+?%\$\}/g, mask, raw;
			
			masked_raw_regex.lastIndex = 0;	// stupid browser "caching" bug
			
			while (mask = masked_raw_regex.exec(content)) {
				mask = mask[0];
				if (_raw_masks[mask]) {
					raw = "{$%"+_raw_masks[mask]+"%$}";
					content = content.substring(0,(masked_raw_regex.lastIndex-mask.length))+raw+content.substring(masked_raw_regex.lastIndex);
					masked_raw_regex.lastIndex -= (mask.length - raw.length);
					_raw_masks[mask] = null;
				}
			}
			return content;
		}
		
		function processManifest(contents) {
			_manifest_loading = false;
			manifest = JSON.parse(contents)["templates"];
			
			for (var i=0, len=_queue.length; i<len; i++) {
				_queue[i]();
			}
			_queue = [];
		}
		
		function tokenizeExtraVars(vars) {
			var tokens = [], tokens2 = [], captured_idx = 0, len = vars.length, tmp, cnt = 0,
				tokenizer = /["'?:()#=[\]]/g
			;
			tokenizer.lastIndex = 0;	// stupid browser "caching" bug
			
			do {
				tmp = tokenizer.exec(vars);
				if (tmp != null) {
					tmp = tmp[0];
					if ((tokenizer.lastIndex-tmp.length) > captured_idx) {
						tokens[cnt++] = _util.faster_trim(vars.substring(captured_idx,tokenizer.lastIndex-tmp.length));
					}
					captured_idx = tokenizer.lastIndex;
					tokens[cnt++] = tmp;
				}
				else { // no more tokens
					tokens[cnt++] = _util.faster_trim(vars.substring(captured_idx,vars.length));
					break;
				}
			}
			while (captured_idx < len)
			return tokens;
		}
		
		function qualifyExtraVars(tokens,idx) {
			var i, len, ternary_level = 0, quote_literal = false;
			if (typeof idx == "undefined") idx = {i:0};
						
			for (i=idx.i; i<tokens.length; i++) {
				if (tokens[i] == "" || tokens[i].match(/^\s+$/)) continue;
				if (tokens[i] == "'" || tokens[i] == "\"") quote_literal = !quote_literal;
				else {
					if (!quote_literal) {
						if (tokens[i] == "(") {
							idx.i = i+1;
							qualifyExtraVars(tokens,idx);
							i = idx.i;
							continue;
						}
						else if (tokens[i] == ")") {
							if (ternary_level > 0) {
								tokens.splice(i,0,":","\"","\"");
								ternary_level--;
								i = i + 3;
								idx.i = i;
							}
							break;
						}
						else if (tokens[i] == "?") ternary_level++;
						else if (tokens[i] == ":") ternary_level--;
						else if (tokens[i].match(/^[a-z]/)) { // regular identifier
							tokens[i] = "_."+tokens[i];	// namespace the identifier
						}
					}
				}
			}
			
			while (ternary_level > 0) {
				tokens.splice(i,0,":","\"","\"");
				ternary_level--;
				i = i + 3;
			}
			
			idx.i = i;
			return _util.faster_trim(tokens.join(""));
		}
		
		function compileSubTemplate(file,id) {
			if (!_templates[file][id]) return;
			
			var name = file+id, out = [], tmp, tmp2, tmp3, tokens, i, len, 
				captured_idx = 0, cnt=0, loop_level = 0,
				rightContext,
				tmpl_regex = /(\{\$([%=*]))|(\{\$\})|(%?\$?\})/g,
				tmpl = _templates[file][id].text, 
				tvars = _templates[file][id].vars,
				fn_source,
				fn_name = name.replace(/[^a-zA-Z0-9_]/g,"_")
			;
			tmpl_regex.lastIndex = 0;	// stupid browser "caching" bug
			
			out[cnt++] = "var OBJTOSTRING=Object.prototype.toString,";	// start outer "closure" definition
			out[cnt++] = "$UTIL=$HB.Util;";
			out[cnt++] = "function "+fn_name+"(_){";	// start main template function definition

			if (tmpl == "") out[cnt++] = "return \"\";";
			else {
				out[cnt++] = "var out=[],c=0;";
				
				// handle template variable declarations, if any
				if (tvars.length > 0) {
					out[cnt++] = "_=$UTIL.cloneObj(_);";	// sandbox sub-template namespace by cloning it

					// add declarations
					for (i=0, len=tvars.length; i<len; i++) {
						tmp = tvars[i].replace(/\n|\r/," ");
						
						tokens = tokenizeExtraVars(tmp);
						
						out[cnt++] = qualifyExtraVars(tokens) + ";";
					}
				}
				
				len = tmpl.length;
				do {
					tmp = tmpl_regex.exec(tmpl);
					rightContext = RegExp.rightContext;

					if (tmp != null) {
						if ((tmp[1] != null && tmp[1] != "") || (tmp[3] != null && tmp[3] != "")) {	// found a template-tag start or end token
							if ((tmpl_regex.lastIndex-tmp[0].length) > captured_idx) {
								out[cnt++] = "out[c++]=\""+quote_str(tmpl.substring(captured_idx,tmpl_regex.lastIndex-tmp[0].length))+"\";";
							}
							captured_idx = tmpl_regex.lastIndex;
							
							if (tmp[2] != null && tmp[2] !== "") {	// tag type-identifier
								tmp2 = rightContext.match(/\s*([^\s\$\}]+)/);
							
								if (tmp[2] == "%") {	// raw-output tag, drop in masked token
									tmp2 = tmp2[1];
									if (tmp2.charAt(tmp2.length-1) == "%") tmp2 = tmp2.substring(0,tmp2.length-1);
									
									out[cnt++] = "out[c++]=\""+quote_str(_raw_masks["{$%"+tmp2+"%$}"])+"\";";
								}
								else if (tmp[2] == "*") {	// loop tag, set up loop function
									tmp2 = tmp2[1];
									out[cnt++] = "(function(_){";	// start loop namespace function definition
									out[cnt++] = "var tmp,";	// declare some private helper variables
									out[cnt++] = "len,";
									out[cnt++] = "i,";
									out[cnt++] = "idx,";
									out[cnt++] = "items,";
									out[cnt++] = "iterobj=_."+tmp2+";";
									out[cnt++] = "function do_loop(item){";	// start "do_loop" definition
									out[cnt++] = "_.item=item;";
									loop_level++;
								}
								else if (tmp[2] == "=") {	// replacement/include tag
									tmp2 = tmp2[1];
									tmp3 = tmp2.match(/@(([^"']+)|((["'])(.*)\4))/);

									if (tmp3) {
										if (tmp3[2] != null && tmp3[2] !== "") {
											// TODO: capture and resolve data ref to put on _check_queue
											// _check_queue[_check_queue.length] = ...
											out[cnt++] = "tmp=$UTIL.uriCanonical(_."+tmp3[2]+",\""+file+"\");";
										}
										else if (tmp3[5] != null && tmp3[5] !== "") {
											_check_queue[_check_queue.length] = publicAPI.Util.uriCanonical(tmp3[5],file);
											out[cnt++] = "tmp=$UTIL.uriCanonical(\""+tmp3[5]+"\",\""+file+"\");";
										}

										out[cnt++] = "if(fnStore[tmp]&&fnStore[tmp].func){";
										out[cnt++] = "out[c++]=fnStore[tmp].func(_);";
										out[cnt++] = "}";
									}
									else {
										out[cnt++] = "out[c++]=_."+tmp2+";";
									}
								}
							}
							else if (tmp[3] != null && tmp[3] !== "") { // tag-block close found
								if (loop_level > 0) {	// closing a loop block, set up loop iterators
									out[cnt++] = "}";	// end "do_loop" definition

									out[cnt++] = "if(typeof iterobj!=\"object\"){";
									out[cnt++] = "iterobj=[iterobj];";
									out[cnt++] = "}";	// end if-statement
									out[cnt++] = "if(typeof OBJTOSTRING.call(iterobj)==\"[object Array]\"){"; // loop over an array
									out[cnt++] = "for(i=0,len=iterobj.length;i<len;i++){";
									out[cnt++] = "do_loop({key:i,value:iterobj[i],first:(i===0),last:(i===(len-1)),odd:(i%2==1),even:(i%2==0)});";
									out[cnt++] = "}";	// end for-loop
									out[cnt++] = "}";	// end if-statement
									out[cnt++] = "else{";	// loop over a regular object
									out[cnt++] = "items=[];";
									out[cnt++] = "idx=0;";
									out[cnt++] = "for(i in iterobj){";	// loop over object's properties
									out[cnt++] = "if(iterobj.hasOwnProperty(i)){";
									out[cnt++] = "items[idx++]={key:i,value:iterobj[i],first:(idx===0),odd:(idx%2==1),even:(idx%2==0)};";
									out[cnt++] = "}";	// end if-statement		TODO: loop over shadowed properties as well
									out[cnt++] = "}";	// end for-loop
									out[cnt++] = "for(i=0,len=items.length;i<len;i++){";
									out[cnt++] = "items[i].last=(i===(len-1));";
									out[cnt++] = "do_loop(items[i]);";
									out[cnt++] = "}";	// end for-loop
									out[cnt++] = "}";	// end else
									out[cnt++] = "})($UTIL.cloneObj(_));";	// end loop namespace function definition, execute it with copy of "_" namespace
									loop_level--;
								}
							}
						}
						else {	// template self-closing tag end found
							captured_idx = tmpl_regex.lastIndex;
						}
					}
					else { // no more tokens
						out[cnt++] = "out[c++]=\""+quote_str(tmpl.substring(captured_idx,tmpl.length))+"\";";
						break;
					}
				}
				while (captured_idx < len) 

				
				out[cnt++] = "return out.join(\"\");";
			}
			out[cnt++] = "}";	// end main template function definition
			out[cnt++] = "return "+fn_name+";";	// end outer closer definition
			
			fn_source = out.join("");	// TODO: optimize; look for and collapse mutliple subsequent "out[c++]=..." occurences
						
			publicAPI.fnStore[name] = {source:fn_source,hash:""};
		}
		
		function processSubTemplates(content,file,onlyID) {
			var template_regex = /\{\$\:\s*(["'])#[^"']+\1[^}]*\$?\}/g, 
				template_id_regex = /\{\$\:\s*(["'])(#[^"']+)\1/, 
				template_comment_regex = /\{\$\/[^\/]*?\/\$\}/,
				template_raw_regex = /\{\$%(?:.|\n|\r)*?%\$\}/g,
				template_extras_regex = /((\|\s*[^|$]+\s*)*)\$?\}$/,
				end_template_regex = /\{?\$\}?/g,
				id, extras, st, et, raw, mask, template, start, end, level
			;
			
			template_regex.lastIndex = template_raw_regex.lastIndex = end_template_regex.lastIndex = 0;	// stupid browser "caching" bug
			
			// mask out raw sections
			while (raw = template_raw_regex.exec(content)) {
				raw = raw[0];
				mask = mask_raw(raw,content);
				content = content.substring(0,(template_raw_regex.lastIndex-raw.length))+mask+content.substring(template_raw_regex.lastIndex);
				template_raw_regex.lastIndex -= (raw.length - mask.length);
			}
			
			// remove template comment blocks 
			content = content.replace(template_comment_regex,"");
			
			if (!_templates[file]) _templates[file] = {};
			
			// process each sub-template
			while ((st = template_regex.exec(content))) {
				end_template_regex.lastIndex = 0;
				st = st[0];
				id = st.match(template_id_regex);
				id = id[2];
				
				if (!onlyID || id === onlyID) {	// if we didn't ask for an ID, or we've found the specific ID asked for
					extras = st.match(template_extras_regex);
					if (extras) {
						extras = extras[1];
						extras = extras.replace(/^\s*\|\s*/,"");
						extras = _util.faster_trim(extras);
						if (extras != "") {
							extras = extras.split(/\s*\|\s*/);
						}
						else extras = [];
					}
					else extras = [];
					
					if (st.match(/\$\}$/)) template = "";	// self-closing declaration; template content is empty
					else {
						start = template_regex.lastIndex;
						end = 0;
						level = 1;
						end_template_regex.lastIndex = start;
						while (!end && (et = end_template_regex.exec(content))) {
							et = et[0];
							if (et == "{$}" || et == "$}") level--;
							else if (et == "{$") level++;
							
							if (level == 0) end = end_template_regex.lastIndex - et.length;
						}
						template = content.substring(start,end);
						template_regex.lastIndex = end;
					}
					_templates[file][id] = {text:template, vars:extras};
					
					if (id === onlyID) break;	// bail since the requested template id was processed
				}
			}
		}
				
		function handleTemplate(content,id,data,cb,file) {
			var extends_tag_regex = /^\s*(\{\$\+\s*(["'])([^"]*)\2\s*\$\})/, 
				extends_tag = content.match(extends_tag_regex)
			;
			file = orEmptyStr(file);
			
			if (!_templates[file] || !_templates[file][id]) {
				
				if (extends_tag && extends_tag[3]) {	// template extends another template; grab and concat
					var extends_tmpl = templateURLsplit(extends_tag[3]), orig_content = content.replace(extends_tag_regex,"");
									
					publicAPI.Loader.get(extends_tmpl.src,function(content){
						if (extends_tmpl.id) {
							var sub_extends = content.match(extends_tag_regex);
							processSubTemplates(content,file,extends_tmpl.id);
							content = "{$: \""+extends_tmpl.id+"\""+(_templates[file][extends_tmpl.id].vars.length?" | "+_templates[file][extends_tmpl.id].vars.join(" | "):"")+" }"+unmask_raw(_templates[file][extends_tmpl.id].text)+"{$}";
							_templates[file][extends_tmpl.id] = null;
							if (sub_extends) content = sub_extends[3]+"\n\n"+content;
						}
						handleTemplate(content+"\n\n"+orig_content,id,data,cb,file);
					});
					return;
				}
				else {
					processSubTemplates(content,file);
					
					for (var i in _templates[file]) {
						compileSubTemplate(file,i);
						
						if (publicAPI.fnStore[file+i] && !publicAPI.fnStore[file+i].func) {
							publicAPI.fnStore[file+i].func = new Function("$HB","fnStore",publicAPI.fnStore[file+i].source)(publicAPI,publicAPI.fnStore);
						}
					}
					
					// TODO: process _check_queue
					
				}
			}
			if (publicAPI.fnStore[file+id] && publicAPI.fnStore[file+id].func) cb(publicAPI.fnStore[file+id].func({data:data}));
			else cb("");
		}
		
		function passthruFile(src,cb) {
			var template = templateURLsplit(src);
			if (template.src) {
				publicAPI.Loader.get(template.src,cb);
			}
		}
		
		function processFileTemplate(src,data,cb) {
			var template = templateURLsplit(src);
			if (template.src) {
				publicAPI.Loader.get(template.src,function(content){handleTemplate(content,template.id,data,cb,template.src);});
			}
		}
		
		function processStateTemplate(state,data,cb) {
			if (manifest[state]) {
				processFileTemplate(manifest[state],data,cb);
			}
		}
		
		publicAPI = {
			fnStore:{},
			
			init:init,
			processTemplate:handleTemplate,
			passthruFile:passthruFile,
			processFile:processFileTemplate,	
			processState:function(){
				var args = arguments;
				if (_manifest_loading) _queue[_queue.length] = function(){processStateTemplate.apply(null,args);};
				else processStateTemplate.apply(null,args);
			},	
			
			clone:function(){return engine();},
			noConflict:rollback
		};
		
		return publicAPI;
	};

	function rollback(deep) {
		var _hb = global.Handlebar, _hb_util, _hb_loader, _hb_dataclient;
		
		if (deep) {
			_hb_util = global.Handlebar.Util.noConflict();
			_hb_loader = global.Handlebar.Loader.noConflict();
			_hb_dataclient = global.Handlebar.DataClient.noConflict();
		}
		
		global.Handlebar = _Handlebar;
		global.$HB = _$HB;
		
		global.Handlebar.Util = _hb_util;
		global.Handlebar.Loader = _hb_loader;
		global.Handlebar.DataClient = _hb_dataclient;
		return _hb;
	}
	
	global.Handlebar = global.$HB = engine();
})(this);