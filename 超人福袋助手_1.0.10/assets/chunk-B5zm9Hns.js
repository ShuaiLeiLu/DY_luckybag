import { y as root, bI as toString, bm as cB, bJ as cNotM, bp as cM, bl as c, bq as cE, d as defineComponent, a_ as h, bv as useConfig, bK as useStyle, bA as useRtl, ap as provide, bL as buttonGroupInjectionKey, bi as derived, bM as warn, aw as mergeProps, bz as useTheme, s as computed, bC as useThemeClass, aG as Fragment, r as ref, o as onMounted, aj as watchEffect, bs as resolveWrappedSlot, c as createElementBlock, f as openBlock, ar as createBaseVNode, e as onUnmounted, w as watch, az as createBlock, aA as withCtx, l as createVNode, v as unref, bG as Button, aE as createTextVNode, aC as createCommentVNode, aF as toDisplayString, bH as __unplugin_components_2, bf as createApp } from "./chunk-CJtm-jMm.js";
import { d as getDefaultExportFromCjs, t as toNumber, f as formatLength, h as useLocale, u as useAuth, _ as _sfc_main$2 } from "./chunk-BV_hJFqM.js";
import { s as storage } from "./chunk-B1D7y5qx.js";
import { _ as __unplugin_components_3 } from "./chunk-Buj9EapW.js";
var loglevel$1 = { exports: {} };
var loglevel = loglevel$1.exports;
var hasRequiredLoglevel;
function requireLoglevel() {
  if (hasRequiredLoglevel) return loglevel$1.exports;
  hasRequiredLoglevel = 1;
  (function(module) {
    (function(root2, definition) {
      if (module.exports) {
        module.exports = definition();
      } else {
        root2.log = definition();
      }
    })(loglevel, function() {
      var noop = function() {
      };
      var undefinedType = "undefined";
      var isIE = typeof window !== undefinedType && typeof window.navigator !== undefinedType && /Trident\/|MSIE /.test(window.navigator.userAgent);
      var logMethods = [
        "trace",
        "debug",
        "info",
        "warn",
        "error"
      ];
      var _loggersByName = {};
      var defaultLogger = null;
      function bindMethod(obj, methodName) {
        var method = obj[methodName];
        if (typeof method.bind === "function") {
          return method.bind(obj);
        } else {
          try {
            return Function.prototype.bind.call(method, obj);
          } catch (e) {
            return function() {
              return Function.prototype.apply.apply(method, [obj, arguments]);
            };
          }
        }
      }
      function traceForIE() {
        if (console.log) {
          if (console.log.apply) {
          } else {
            Function.prototype.apply.apply(console.log, [console, arguments]);
          }
        }
        if (console.trace) ;
      }
      function realMethod(methodName) {
        if (methodName === "debug") {
          methodName = "log";
        }
        if (typeof console === undefinedType) {
          return false;
        } else if (methodName === "trace" && isIE) {
          return traceForIE;
        } else if (console[methodName] !== void 0) {
          return bindMethod(console, methodName);
        } else if (console.log !== void 0) {
          return bindMethod(console, "log");
        } else {
          return noop;
        }
      }
      function replaceLoggingMethods() {
        var level = this.getLevel();
        for (var i = 0; i < logMethods.length; i++) {
          var methodName = logMethods[i];
          this[methodName] = i < level ? noop : this.methodFactory(methodName, level, this.name);
        }
        this.log = this.debug;
        if (typeof console === undefinedType && level < this.levels.SILENT) {
          return "No console available for logging";
        }
      }
      function enableLoggingWhenConsoleArrives(methodName) {
        return function() {
          if (typeof console !== undefinedType) {
            replaceLoggingMethods.call(this);
            this[methodName].apply(this, arguments);
          }
        };
      }
      function defaultMethodFactory(methodName, _level, _loggerName) {
        return realMethod(methodName) || enableLoggingWhenConsoleArrives.apply(this, arguments);
      }
      function Logger(name, factory) {
        var self2 = this;
        var inheritedLevel;
        var defaultLevel;
        var userLevel;
        var storageKey = "loglevel";
        if (typeof name === "string") {
          storageKey += ":" + name;
        } else if (typeof name === "symbol") {
          storageKey = void 0;
        }
        function persistLevelIfPossible(levelNum) {
          var levelName = (logMethods[levelNum] || "silent").toUpperCase();
          if (typeof window === undefinedType || !storageKey) return;
          try {
            window.localStorage[storageKey] = levelName;
            return;
          } catch (ignore) {
          }
          try {
            window.document.cookie = encodeURIComponent(storageKey) + "=" + levelName + ";";
          } catch (ignore) {
          }
        }
        function getPersistedLevel() {
          var storedLevel;
          if (typeof window === undefinedType || !storageKey) return;
          try {
            storedLevel = window.localStorage[storageKey];
          } catch (ignore) {
          }
          if (typeof storedLevel === undefinedType) {
            try {
              var cookie = window.document.cookie;
              var cookieName = encodeURIComponent(storageKey);
              var location = cookie.indexOf(cookieName + "=");
              if (location !== -1) {
                storedLevel = /^([^;]+)/.exec(
                  cookie.slice(location + cookieName.length + 1)
                )[1];
              }
            } catch (ignore) {
            }
          }
          if (self2.levels[storedLevel] === void 0) {
            storedLevel = void 0;
          }
          return storedLevel;
        }
        function clearPersistedLevel() {
          if (typeof window === undefinedType || !storageKey) return;
          try {
            window.localStorage.removeItem(storageKey);
          } catch (ignore) {
          }
          try {
            window.document.cookie = encodeURIComponent(storageKey) + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC";
          } catch (ignore) {
          }
        }
        function normalizeLevel(input) {
          var level = input;
          if (typeof level === "string" && self2.levels[level.toUpperCase()] !== void 0) {
            level = self2.levels[level.toUpperCase()];
          }
          if (typeof level === "number" && level >= 0 && level <= self2.levels.SILENT) {
            return level;
          } else {
            throw new TypeError("log.setLevel() called with invalid level: " + input);
          }
        }
        self2.name = name;
        self2.levels = {
          "TRACE": 0,
          "DEBUG": 1,
          "INFO": 2,
          "WARN": 3,
          "ERROR": 4,
          "SILENT": 5
        };
        self2.methodFactory = factory || defaultMethodFactory;
        self2.getLevel = function() {
          if (userLevel != null) {
            return userLevel;
          } else if (defaultLevel != null) {
            return defaultLevel;
          } else {
            return inheritedLevel;
          }
        };
        self2.setLevel = function(level, persist) {
          userLevel = normalizeLevel(level);
          if (persist !== false) {
            persistLevelIfPossible(userLevel);
          }
          return replaceLoggingMethods.call(self2);
        };
        self2.setDefaultLevel = function(level) {
          defaultLevel = normalizeLevel(level);
          if (!getPersistedLevel()) {
            self2.setLevel(level, false);
          }
        };
        self2.resetLevel = function() {
          userLevel = null;
          clearPersistedLevel();
          replaceLoggingMethods.call(self2);
        };
        self2.enableAll = function(persist) {
          self2.setLevel(self2.levels.TRACE, persist);
        };
        self2.disableAll = function(persist) {
          self2.setLevel(self2.levels.SILENT, persist);
        };
        self2.rebuild = function() {
          if (defaultLogger !== self2) {
            inheritedLevel = normalizeLevel(defaultLogger.getLevel());
          }
          replaceLoggingMethods.call(self2);
          if (defaultLogger === self2) {
            for (var childName in _loggersByName) {
              _loggersByName[childName].rebuild();
            }
          }
        };
        inheritedLevel = normalizeLevel(
          defaultLogger ? defaultLogger.getLevel() : "WARN"
        );
        var initialLevel = getPersistedLevel();
        if (initialLevel != null) {
          userLevel = normalizeLevel(initialLevel);
        }
        replaceLoggingMethods.call(self2);
      }
      defaultLogger = new Logger();
      defaultLogger.getLogger = function getLogger(name) {
        if (typeof name !== "symbol" && typeof name !== "string" || name === "") {
          throw new TypeError("You must supply a name when creating a logger.");
        }
        var logger2 = _loggersByName[name];
        if (!logger2) {
          logger2 = _loggersByName[name] = new Logger(
            name,
            defaultLogger.methodFactory
          );
        }
        return logger2;
      };
      var _log = typeof window !== undefinedType ? window.log : void 0;
      defaultLogger.noConflict = function() {
        if (typeof window !== undefinedType && window.log === defaultLogger) {
          window.log = _log;
        }
        return defaultLogger;
      };
      defaultLogger.getLoggers = function getLoggers() {
        return _loggersByName;
      };
      defaultLogger["default"] = defaultLogger;
      return defaultLogger;
    });
  })(loglevel$1);
  return loglevel$1.exports;
}
var loglevelExports = /* @__PURE__ */ requireLoglevel();
const log = /* @__PURE__ */ getDefaultExportFromCjs(loglevelExports);
const LOG_LEVELS = {
  TRACE: "trace",
  DEBUG: "debug",
  INFO: "info",
  WARN: "warn",
  ERROR: "error"
};
const CONTEXT_TYPES = {
  BACKGROUND: "background",
  CONTENT_SCRIPT: "contentScript",
  POPUP: "popup",
  OPTIONS: "options",
  SIDEPANEL: "sidepanel",
  DEVTOOLS: "devtools",
  NEWTAB: "newtab",
  UNKNOWN: "unknown"
};
const STORAGE_KEY = "logger_config";
function detectContext() {
  if (typeof window === "undefined") {
    return CONTEXT_TYPES.BACKGROUND;
  }
  const path = window.location?.pathname || "";
  if (path.includes("popup.html")) return CONTEXT_TYPES.POPUP;
  if (path.includes("options.html")) return CONTEXT_TYPES.OPTIONS;
  if (path.includes("sidepanel.html")) return CONTEXT_TYPES.SIDEPANEL;
  if (path.includes("devtools.html")) return CONTEXT_TYPES.DEVTOOLS;
  if (path.includes("newtab.html")) return CONTEXT_TYPES.NEWTAB;
  if (window.location?.protocol === "chrome-extension:") {
    return CONTEXT_TYPES.UNKNOWN;
  }
  if (typeof chrome !== "undefined" && chrome.runtime?.id) {
    return CONTEXT_TYPES.CONTENT_SCRIPT;
  }
  return CONTEXT_TYPES.UNKNOWN;
}
function formatTimestamp() {
  const now = /* @__PURE__ */ new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const ms = String(now.getMilliseconds()).padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${ms}`;
}
function getLevelColor(level) {
  const colors = {
    [LOG_LEVELS.TRACE]: "#999",
    [LOG_LEVELS.DEBUG]: "#0ea5e9",
    [LOG_LEVELS.INFO]: "#10b981",
    [LOG_LEVELS.WARN]: "#f59e0b",
    [LOG_LEVELS.ERROR]: "#ef4444"
  };
  return colors[level] || "#666";
}
function getContextColor(context) {
  const colors = {
    [CONTEXT_TYPES.BACKGROUND]: "#8b5cf6",
    [CONTEXT_TYPES.CONTENT_SCRIPT]: "#ec4899",
    [CONTEXT_TYPES.POPUP]: "#06b6d4",
    [CONTEXT_TYPES.OPTIONS]: "#f97316",
    [CONTEXT_TYPES.SIDEPANEL]: "#6366f1",
    [CONTEXT_TYPES.DEVTOOLS]: "#14b8a6",
    [CONTEXT_TYPES.NEWTAB]: "#a855f7"
  };
  return colors[context] || "#64748b";
}
function createLogger(name = "app", options = {}) {
  const {
    context = detectContext(),
    level = LOG_LEVELS.INFO,
    enablePersist = false,
    enableCollect = false
  } = options;
  const logger2 = log.getLogger(name);
  logger2.setLevel(level);
  const originalFactory = logger2.methodFactory;
  logger2.methodFactory = function(methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);
    return function(...args) {
      const timestamp = formatTimestamp();
      const levelColor = getLevelColor(methodName);
      const contextColor = getContextColor(context);
      const prefix = [
        `%c[${timestamp}]%c`,
        `%c[${methodName.toUpperCase()}]%c`,
        `%c[${context}]%c`,
        loggerName !== "app" ? `%c[${loggerName}]%c` : ""
      ].filter(Boolean).join(" ");
      const styles = [
        "color: #999",
        "",
        `color: ${levelColor}; font-weight: bold`,
        "",
        `color: ${contextColor}; font-weight: bold`,
        ""
      ];
      if (loggerName !== "app") {
        styles.push("color: #666", "");
      }
      rawMethod.apply(void 0, [prefix, ...styles, ...args]);
      if (enablePersist) {
        persistLog(methodName, context, loggerName, args);
      }
      if (enableCollect && context !== CONTEXT_TYPES.BACKGROUND) {
        collectLog(methodName, context, loggerName, args);
      }
    };
  };
  logger2.setLevel(logger2.getLevel());
  logger2.context = context;
  logger2.name = name;
  logger2.setLogLevel = function(newLevel) {
    logger2.setLevel(newLevel);
    if (enablePersist) {
      saveConfig({ level: newLevel });
    }
  };
  logger2.getConfig = function() {
    return {
      name,
      context,
      level: logger2.getLevel(),
      enablePersist,
      enableCollect
    };
  };
  if (enablePersist) {
    restoreConfig(logger2);
  }
  return logger2;
}
async function persistLog(level, context, name, args) {
  try {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    const logEntry = {
      timestamp: Date.now(),
      level,
      context,
      name,
      message: args.map((arg) => typeof arg === "object" ? JSON.stringify(arg) : String(arg)).join(" ")
    };
    const result = await chrome.storage.local.get(["logs"]);
    const logs = result.logs || [];
    logs.push(logEntry);
    if (logs.length > 1e3) {
      logs.shift();
    }
    await chrome.storage.local.set({ logs });
  } catch (err) {
  }
}
function collectLog(level, context, name, args) {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime) return;
    chrome.runtime.sendMessage({
      type: "LOG_COLLECT",
      log: {
        timestamp: Date.now(),
        level,
        context,
        name,
        message: args
      }
    }).catch(() => {
    });
  } catch {
  }
}
async function saveConfig(config) {
  try {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
  } catch (err) {
  }
}
async function restoreConfig(logger2) {
  try {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const config = result[STORAGE_KEY];
    if (config?.level) {
      logger2.setLevel(config.level);
    }
  } catch (err) {
  }
}
const logger = createLogger("app", {
  level: LOG_LEVELS.INFO,
  enablePersist: false,
  enableCollect: false
});
var INFINITY = 1 / 0, MAX_INTEGER = 17976931348623157e292;
function toFinite(value) {
  if (!value) {
    return value === 0 ? value : 0;
  }
  value = toNumber(value);
  if (value === INFINITY || value === -INFINITY) {
    var sign = value < 0 ? -1 : 1;
    return sign * MAX_INTEGER;
  }
  return value === value ? value : 0;
}
function toInteger(value) {
  var result = toFinite(value), remainder = result % 1;
  return result === result ? remainder ? result - remainder : result : 0;
}
var nativeIsFinite = root.isFinite, nativeMin = Math.min;
function createRound(methodName) {
  var func = Math[methodName];
  return function(number, precision) {
    number = toNumber(number);
    precision = precision == null ? 0 : nativeMin(toInteger(precision), 292);
    if (precision && nativeIsFinite(number)) {
      var pair = (toString(number) + "e").split("e"), value = func(pair[0] + "e" + (+pair[1] + precision));
      pair = (toString(value) + "e").split("e");
      return +(pair[0] + "e" + (+pair[1] - precision));
    }
    return func(number);
  };
}
var round = createRound("round");
const zero = "0!important";
const n1 = "-1px!important";
function createLeftBorderStyle(type) {
  return cM(`${type}-type`, [c("& +", [cB("button", {}, [cM(`${type}-type`, [cE("border", {
    borderLeftWidth: zero
  }), cE("state-border", {
    left: n1
  })])])])]);
}
function createTopBorderStyle(type) {
  return cM(`${type}-type`, [c("& +", [cB("button", [cM(`${type}-type`, [cE("border", {
    borderTopWidth: zero
  }), cE("state-border", {
    top: n1
  })])])])]);
}
const style$3 = cB("button-group", `
 flex-wrap: nowrap;
 display: inline-flex;
 position: relative;
`, [cNotM("vertical", {
  flexDirection: "row"
}, [cNotM("rtl", [cB("button", [c("&:first-child:not(:last-child)", `
 margin-right: ${zero};
 border-top-right-radius: ${zero};
 border-bottom-right-radius: ${zero};
 `), c("&:last-child:not(:first-child)", `
 margin-left: ${zero};
 border-top-left-radius: ${zero};
 border-bottom-left-radius: ${zero};
 `), c("&:not(:first-child):not(:last-child)", `
 margin-left: ${zero};
 margin-right: ${zero};
 border-radius: ${zero};
 `), createLeftBorderStyle("default"), cM("ghost", [createLeftBorderStyle("primary"), createLeftBorderStyle("info"), createLeftBorderStyle("success"), createLeftBorderStyle("warning"), createLeftBorderStyle("error")])])])]), cM("vertical", {
  flexDirection: "column"
}, [cB("button", [c("&:first-child:not(:last-child)", `
 margin-bottom: ${zero};
 margin-left: ${zero};
 margin-right: ${zero};
 border-bottom-left-radius: ${zero};
 border-bottom-right-radius: ${zero};
 `), c("&:last-child:not(:first-child)", `
 margin-top: ${zero};
 margin-left: ${zero};
 margin-right: ${zero};
 border-top-left-radius: ${zero};
 border-top-right-radius: ${zero};
 `), c("&:not(:first-child):not(:last-child)", `
 margin: ${zero};
 border-radius: ${zero};
 `), createTopBorderStyle("default"), cM("ghost", [createTopBorderStyle("primary"), createTopBorderStyle("info"), createTopBorderStyle("success"), createTopBorderStyle("warning"), createTopBorderStyle("error")])])])]);
const buttonGroupProps = {
  size: {
    type: String,
    default: void 0
  },
  vertical: Boolean
};
const __unplugin_components_4 = defineComponent({
  name: "ButtonGroup",
  props: buttonGroupProps,
  setup(props) {
    const {
      mergedClsPrefixRef,
      mergedRtlRef
    } = useConfig(props);
    useStyle("-button-group", style$3, mergedClsPrefixRef);
    provide(buttonGroupInjectionKey, props);
    const rtlEnabledRef = useRtl("ButtonGroup", mergedRtlRef, mergedClsPrefixRef);
    return {
      rtlEnabled: rtlEnabledRef,
      mergedClsPrefix: mergedClsPrefixRef
    };
  },
  render() {
    const {
      mergedClsPrefix
    } = this;
    return h("div", {
      class: [`${mergedClsPrefix}-button-group`, this.rtlEnabled && `${mergedClsPrefix}-button-group--rtl`, this.vertical && `${mergedClsPrefix}-button-group--vertical`],
      role: "group"
    }, this.$slots);
  }
});
function self$2(vars) {
  const {
    textColorBase,
    opacity1,
    opacity2,
    opacity3,
    opacity4,
    opacity5
  } = vars;
  return {
    color: textColorBase,
    opacity1Depth: opacity1,
    opacity2Depth: opacity2,
    opacity3Depth: opacity3,
    opacity4Depth: opacity4,
    opacity5Depth: opacity5
  };
}
const iconLight = {
  common: derived,
  self: self$2
};
const style$2 = cB("icon", `
 height: 1em;
 width: 1em;
 line-height: 1em;
 text-align: center;
 display: inline-block;
 position: relative;
 fill: currentColor;
`, [cM("color-transition", {
  transition: "color .3s var(--n-bezier)"
}), cM("depth", {
  color: "var(--n-color)"
}, [c("svg", {
  opacity: "var(--n-opacity)",
  transition: "opacity .3s var(--n-bezier)"
})]), c("svg", {
  height: "1em",
  width: "1em"
})]);
const iconProps = Object.assign(Object.assign({}, useTheme.props), {
  depth: [String, Number],
  size: [Number, String],
  color: String,
  component: [Object, Function]
});
const NIcon = defineComponent({
  _n_icon__: true,
  name: "Icon",
  inheritAttrs: false,
  props: iconProps,
  setup(props) {
    const {
      mergedClsPrefixRef,
      inlineThemeDisabled
    } = useConfig(props);
    const themeRef = useTheme("Icon", "-icon", style$2, iconLight, props, mergedClsPrefixRef);
    const cssVarsRef = computed(() => {
      const {
        depth
      } = props;
      const {
        common: {
          cubicBezierEaseInOut
        },
        self: self2
      } = themeRef.value;
      if (depth !== void 0) {
        const {
          color,
          [`opacity${depth}Depth`]: opacity
        } = self2;
        return {
          "--n-bezier": cubicBezierEaseInOut,
          "--n-color": color,
          "--n-opacity": opacity
        };
      }
      return {
        "--n-bezier": cubicBezierEaseInOut,
        "--n-color": "",
        "--n-opacity": ""
      };
    });
    const themeClassHandle = inlineThemeDisabled ? useThemeClass("icon", computed(() => `${props.depth || "d"}`), cssVarsRef, props) : void 0;
    return {
      mergedClsPrefix: mergedClsPrefixRef,
      mergedStyle: computed(() => {
        const {
          size,
          color
        } = props;
        return {
          fontSize: formatLength(size),
          color
        };
      }),
      cssVars: inlineThemeDisabled ? void 0 : cssVarsRef,
      themeClass: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.themeClass,
      onRender: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.onRender
    };
  },
  render() {
    var _a;
    const {
      $parent,
      depth,
      mergedClsPrefix,
      component,
      onRender,
      themeClass
    } = this;
    if ((_a = $parent === null || $parent === void 0 ? void 0 : $parent.$options) === null || _a === void 0 ? void 0 : _a._n_icon__) {
      warn("icon", "don't wrap `n-icon` inside `n-icon`");
    }
    onRender === null || onRender === void 0 ? void 0 : onRender();
    return h("i", mergeProps(this.$attrs, {
      role: "img",
      class: [`${mergedClsPrefix}-icon`, themeClass, {
        [`${mergedClsPrefix}-icon--depth`]: depth,
        [`${mergedClsPrefix}-icon--color-transition`]: depth !== void 0
      }],
      style: [this.cssVars, this.mergedStyle]
    }), component ? h(component) : this.$slots);
  }
});
function self$1(vars) {
  const {
    textColor1,
    dividerColor,
    fontWeightStrong
  } = vars;
  return {
    textColor: textColor1,
    color: dividerColor,
    fontWeight: fontWeightStrong
  };
}
const dividerLight = {
  common: derived,
  self: self$1
};
const style$1 = cB("divider", `
 position: relative;
 display: flex;
 width: 100%;
 box-sizing: border-box;
 font-size: 16px;
 color: var(--n-text-color);
 transition:
 color .3s var(--n-bezier),
 background-color .3s var(--n-bezier);
`, [cNotM("vertical", `
 margin-top: 24px;
 margin-bottom: 24px;
 `, [cNotM("no-title", `
 display: flex;
 align-items: center;
 `)]), cE("title", `
 display: flex;
 align-items: center;
 margin-left: 12px;
 margin-right: 12px;
 white-space: nowrap;
 font-weight: var(--n-font-weight);
 `), cM("title-position-left", [cE("line", [cM("left", {
  width: "28px"
})])]), cM("title-position-right", [cE("line", [cM("right", {
  width: "28px"
})])]), cM("dashed", [cE("line", `
 background-color: #0000;
 height: 0px;
 width: 100%;
 border-style: dashed;
 border-width: 1px 0 0;
 `)]), cM("vertical", `
 display: inline-block;
 height: 1em;
 margin: 0 8px;
 vertical-align: middle;
 width: 1px;
 `), cE("line", `
 border: none;
 transition: background-color .3s var(--n-bezier), border-color .3s var(--n-bezier);
 height: 1px;
 width: 100%;
 margin: 0;
 `), cNotM("dashed", [cE("line", {
  backgroundColor: "var(--n-color)"
})]), cM("dashed", [cE("line", {
  borderColor: "var(--n-color)"
})]), cM("vertical", {
  backgroundColor: "var(--n-color)"
})]);
const dividerProps = Object.assign(Object.assign({}, useTheme.props), {
  titlePlacement: {
    type: String,
    default: "center"
  },
  dashed: Boolean,
  vertical: Boolean
});
const __unplugin_components_5 = defineComponent({
  name: "Divider",
  props: dividerProps,
  setup(props) {
    const {
      mergedClsPrefixRef,
      inlineThemeDisabled
    } = useConfig(props);
    const themeRef = useTheme("Divider", "-divider", style$1, dividerLight, props, mergedClsPrefixRef);
    const cssVarsRef = computed(() => {
      const {
        common: {
          cubicBezierEaseInOut
        },
        self: {
          color,
          textColor,
          fontWeight
        }
      } = themeRef.value;
      return {
        "--n-bezier": cubicBezierEaseInOut,
        "--n-color": color,
        "--n-text-color": textColor,
        "--n-font-weight": fontWeight
      };
    });
    const themeClassHandle = inlineThemeDisabled ? useThemeClass("divider", void 0, cssVarsRef, props) : void 0;
    return {
      mergedClsPrefix: mergedClsPrefixRef,
      cssVars: inlineThemeDisabled ? void 0 : cssVarsRef,
      themeClass: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.themeClass,
      onRender: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.onRender
    };
  },
  render() {
    var _a;
    const {
      $slots,
      titlePlacement,
      vertical,
      dashed,
      cssVars,
      mergedClsPrefix
    } = this;
    (_a = this.onRender) === null || _a === void 0 ? void 0 : _a.call(this);
    return h("div", {
      role: "separator",
      class: [`${mergedClsPrefix}-divider`, this.themeClass, {
        [`${mergedClsPrefix}-divider--vertical`]: vertical,
        [`${mergedClsPrefix}-divider--no-title`]: !$slots.default,
        [`${mergedClsPrefix}-divider--dashed`]: dashed,
        [`${mergedClsPrefix}-divider--title-position-${titlePlacement}`]: $slots.default && titlePlacement
      }],
      style: cssVars
    }, !vertical ? h("div", {
      class: `${mergedClsPrefix}-divider__line ${mergedClsPrefix}-divider__line--left`
    }) : null, !vertical && $slots.default ? h(Fragment, null, h("div", {
      class: `${mergedClsPrefix}-divider__title`
    }, this.$slots), h("div", {
      class: `${mergedClsPrefix}-divider__line ${mergedClsPrefix}-divider__line--right`
    })) : null);
  }
});
function self(vars) {
  const {
    textColor2,
    textColor3,
    fontSize,
    fontWeight
  } = vars;
  return {
    labelFontSize: fontSize,
    labelFontWeight: fontWeight,
    valueFontWeight: fontWeight,
    valueFontSize: "24px",
    labelTextColor: textColor3,
    valuePrefixTextColor: textColor2,
    valueSuffixTextColor: textColor2,
    valueTextColor: textColor2
  };
}
const statisticLight = {
  common: derived,
  self
};
const easeOut = (t) => 1 - Math.pow(1 - t, 5);
function tween(props) {
  const {
    from,
    to,
    duration,
    onUpdate,
    onFinish
  } = props;
  const startTime = performance.now();
  const tick = () => {
    const current = performance.now();
    const elapsedTime = Math.min(current - startTime, duration);
    const currentValue = from + (to - from) * easeOut(elapsedTime / duration);
    if (elapsedTime === duration) {
      onFinish();
      return;
    }
    onUpdate(currentValue);
    requestAnimationFrame(tick);
  };
  tick();
}
const numberAnimationProps = {
  to: {
    type: Number,
    default: 0
  },
  precision: {
    type: Number,
    default: 0
  },
  showSeparator: Boolean,
  locale: String,
  from: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  },
  duration: {
    type: Number,
    default: 2e3
  },
  onFinish: Function
};
const __unplugin_components_0 = defineComponent({
  name: "NumberAnimation",
  props: numberAnimationProps,
  setup(props) {
    const {
      localeRef
    } = useLocale("name");
    const {
      duration
    } = props;
    const displayedValueRef = ref(props.from);
    const mergedLocaleRef = computed(() => {
      const {
        locale
      } = props;
      if (locale !== void 0) return locale;
      return localeRef.value;
    });
    let animating = false;
    const onUpdate = (currentValue) => {
      displayedValueRef.value = currentValue;
    };
    const onFinish = () => {
      var _a;
      displayedValueRef.value = props.to;
      animating = false;
      (_a = props.onFinish) === null || _a === void 0 ? void 0 : _a.call(props);
    };
    const animate = (from = props.from, to = props.to) => {
      animating = true;
      displayedValueRef.value = props.from;
      if (from !== to) {
        tween({
          from,
          to,
          duration,
          onUpdate,
          onFinish
        });
      }
    };
    const formattedValueRef = computed(() => {
      var _a;
      const formatted = round(displayedValueRef.value, props.precision).toFixed(props.precision);
      const splitValue = formatted.split(".");
      const numberFormatter = new Intl.NumberFormat(mergedLocaleRef.value);
      const decimalSeparator = (_a = numberFormatter.formatToParts(0.5).find((part) => part.type === "decimal")) === null || _a === void 0 ? void 0 : _a.value;
      const integer = props.showSeparator ? numberFormatter.format(Number(splitValue[0])) : splitValue[0];
      const decimal = splitValue[1];
      return {
        integer,
        decimal,
        decimalSeparator
      };
    });
    function play() {
      if (animating) return;
      animate();
    }
    onMounted(() => {
      watchEffect(() => {
        if (props.active) animate();
      });
    });
    const exposedMethods = {
      play
    };
    return Object.assign({
      formattedValue: formattedValueRef
    }, exposedMethods);
  },
  render() {
    const {
      formattedValue: {
        integer,
        decimal,
        decimalSeparator
      }
    } = this;
    return [integer, decimal ? decimalSeparator : null, decimal];
  }
});
const style = cB("statistic", [cE("label", `
 font-weight: var(--n-label-font-weight);
 transition: .3s color var(--n-bezier);
 font-size: var(--n-label-font-size);
 color: var(--n-label-text-color);
 `), cB("statistic-value", `
 margin-top: 4px;
 font-weight: var(--n-value-font-weight);
 `, [cE("prefix", `
 margin: 0 4px 0 0;
 font-size: var(--n-value-font-size);
 transition: .3s color var(--n-bezier);
 color: var(--n-value-prefix-text-color);
 `, [cB("icon", {
  verticalAlign: "-0.125em"
})]), cE("content", `
 font-size: var(--n-value-font-size);
 transition: .3s color var(--n-bezier);
 color: var(--n-value-text-color);
 `), cE("suffix", `
 margin: 0 0 0 4px;
 font-size: var(--n-value-font-size);
 transition: .3s color var(--n-bezier);
 color: var(--n-value-suffix-text-color);
 `, [cB("icon", {
  verticalAlign: "-0.125em"
})])])]);
const statisticProps = Object.assign(Object.assign({}, useTheme.props), {
  tabularNums: Boolean,
  label: String,
  value: [String, Number]
});
const __unplugin_components_1 = defineComponent({
  name: "Statistic",
  props: statisticProps,
  slots: Object,
  setup(props) {
    const {
      mergedClsPrefixRef,
      inlineThemeDisabled,
      mergedRtlRef
    } = useConfig(props);
    const themeRef = useTheme("Statistic", "-statistic", style, statisticLight, props, mergedClsPrefixRef);
    const rtlEnabledRef = useRtl("Statistic", mergedRtlRef, mergedClsPrefixRef);
    const cssVarsRef = computed(() => {
      const {
        self: {
          labelFontWeight,
          valueFontSize,
          valueFontWeight,
          valuePrefixTextColor,
          labelTextColor,
          valueSuffixTextColor,
          valueTextColor,
          labelFontSize
        },
        common: {
          cubicBezierEaseInOut
        }
      } = themeRef.value;
      return {
        "--n-bezier": cubicBezierEaseInOut,
        "--n-label-font-size": labelFontSize,
        "--n-label-font-weight": labelFontWeight,
        "--n-label-text-color": labelTextColor,
        "--n-value-font-weight": valueFontWeight,
        "--n-value-font-size": valueFontSize,
        "--n-value-prefix-text-color": valuePrefixTextColor,
        "--n-value-suffix-text-color": valueSuffixTextColor,
        "--n-value-text-color": valueTextColor
      };
    });
    const themeClassHandle = inlineThemeDisabled ? useThemeClass("statistic", void 0, cssVarsRef, props) : void 0;
    return {
      rtlEnabled: rtlEnabledRef,
      mergedClsPrefix: mergedClsPrefixRef,
      cssVars: inlineThemeDisabled ? void 0 : cssVarsRef,
      themeClass: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.themeClass,
      onRender: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.onRender
    };
  },
  render() {
    var _a;
    const {
      mergedClsPrefix,
      $slots: {
        default: defaultSlot,
        label: labelSlot,
        prefix: prefixSlot,
        suffix: suffixSlot
      }
    } = this;
    (_a = this.onRender) === null || _a === void 0 ? void 0 : _a.call(this);
    return h("div", {
      class: [`${mergedClsPrefix}-statistic`, this.themeClass, this.rtlEnabled && `${mergedClsPrefix}-statistic--rtl`],
      style: this.cssVars
    }, resolveWrappedSlot(labelSlot, (children) => h("div", {
      class: `${mergedClsPrefix}-statistic__label`
    }, this.label || children)), h("div", {
      class: `${mergedClsPrefix}-statistic-value`,
      style: {
        fontVariantNumeric: this.tabularNums ? "tabular-nums" : ""
      }
    }, resolveWrappedSlot(prefixSlot, (children) => children && h("span", {
      class: `${mergedClsPrefix}-statistic-value__prefix`
    }, children)), this.value !== void 0 ? h("span", {
      class: `${mergedClsPrefix}-statistic-value__content`
    }, this.value) : resolveWrappedSlot(defaultSlot, (children) => children && h("span", {
      class: `${mergedClsPrefix}-statistic-value__content`
    }, children)), resolveWrappedSlot(suffixSlot, (children) => children && h("span", {
      class: `${mergedClsPrefix}-statistic-value__suffix`
    }, children))));
  }
});
const _hoisted_1$6 = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  viewBox: "0 0 512 512"
};
const _hoisted_2$6 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    d: "M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192s192-86 192-192z",
    fill: "none",
    stroke: "currentColor",
    "stroke-miterlimit": "10",
    "stroke-width": "32"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_3$6 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "32",
    d: "M256 176v160"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_4$5 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "32",
    d: "M336 256H176"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_5$2 = [_hoisted_2$6, _hoisted_3$6, _hoisted_4$5];
const AddCircleOutline = defineComponent({
  name: "AddCircleOutline",
  render: function render(_ctx, _cache) {
    return openBlock(), createElementBlock("svg", _hoisted_1$6, _hoisted_5$2);
  }
});
const _hoisted_1$5 = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  viewBox: "0 0 512 512"
};
const _hoisted_2$5 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "32",
    d: "M368 368L144 144"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_3$5 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "32",
    d: "M368 144L144 368"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_4$4 = [_hoisted_2$5, _hoisted_3$5];
const CloseOutline = defineComponent({
  name: "CloseOutline",
  render: function render2(_ctx, _cache) {
    return openBlock(), createElementBlock("svg", _hoisted_1$5, _hoisted_4$4);
  }
});
const _hoisted_1$4 = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  viewBox: "0 0 512 512"
};
const _hoisted_2$4 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-miterlimit": "10",
    "stroke-width": "32",
    d: "M80 160h352"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_3$4 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-miterlimit": "10",
    "stroke-width": "32",
    d: "M80 256h352"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_4$3 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-miterlimit": "10",
    "stroke-width": "32",
    d: "M80 352h352"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_5$1 = [_hoisted_2$4, _hoisted_3$4, _hoisted_4$3];
const MenuOutline = defineComponent({
  name: "MenuOutline",
  render: function render3(_ctx, _cache) {
    return openBlock(), createElementBlock("svg", _hoisted_1$4, _hoisted_5$1);
  }
});
const _hoisted_1$3 = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  viewBox: "0 0 512 512"
};
const _hoisted_2$3 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    d: "M320 146s24.36-12-64-12a160 160 0 1 0 160 160",
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-miterlimit": "10",
    "stroke-width": "32"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_3$3 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "32",
    d: "M256 58l80 80l-80 80"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_4$2 = [_hoisted_2$3, _hoisted_3$3];
const RefreshOutline = defineComponent({
  name: "RefreshOutline",
  render: function render4(_ctx, _cache) {
    return openBlock(), createElementBlock("svg", _hoisted_1$3, _hoisted_4$2);
  }
});
const _hoisted_1$2 = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  viewBox: "0 0 512 512"
};
const _hoisted_2$2 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    d: "M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192s192-86 192-192z",
    fill: "none",
    stroke: "currentColor",
    "stroke-miterlimit": "10",
    "stroke-width": "32"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_3$2 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "32",
    d: "M336 256H176"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_4$1 = [_hoisted_2$2, _hoisted_3$2];
const RemoveCircleOutline = defineComponent({
  name: "RemoveCircleOutline",
  render: function render5(_ctx, _cache) {
    return openBlock(), createElementBlock("svg", _hoisted_1$2, _hoisted_4$1);
  }
});
const _hoisted_1$1 = {
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  viewBox: "0 0 512 512"
};
const _hoisted_2$1 = /* @__PURE__ */ createBaseVNode(
  "path",
  {
    d: "M262.29 192.31a64 64 0 1 0 57.4 57.4a64.13 64.13 0 0 0-57.4-57.4zM416.39 256a154.34 154.34 0 0 1-1.53 20.79l45.21 35.46a10.81 10.81 0 0 1 2.45 13.75l-42.77 74a10.81 10.81 0 0 1-13.14 4.59l-44.9-18.08a16.11 16.11 0 0 0-15.17 1.75A164.48 164.48 0 0 1 325 400.8a15.94 15.94 0 0 0-8.82 12.14l-6.73 47.89a11.08 11.08 0 0 1-10.68 9.17h-85.54a11.11 11.11 0 0 1-10.69-8.87l-6.72-47.82a16.07 16.07 0 0 0-9-12.22a155.3 155.3 0 0 1-21.46-12.57a16 16 0 0 0-15.11-1.71l-44.89 18.07a10.81 10.81 0 0 1-13.14-4.58l-42.77-74a10.8 10.8 0 0 1 2.45-13.75l38.21-30a16.05 16.05 0 0 0 6-14.08c-.36-4.17-.58-8.33-.58-12.5s.21-8.27.58-12.35a16 16 0 0 0-6.07-13.94l-38.19-30A10.81 10.81 0 0 1 49.48 186l42.77-74a10.81 10.81 0 0 1 13.14-4.59l44.9 18.08a16.11 16.11 0 0 0 15.17-1.75A164.48 164.48 0 0 1 187 111.2a15.94 15.94 0 0 0 8.82-12.14l6.73-47.89A11.08 11.08 0 0 1 213.23 42h85.54a11.11 11.11 0 0 1 10.69 8.87l6.72 47.82a16.07 16.07 0 0 0 9 12.22a155.3 155.3 0 0 1 21.46 12.57a16 16 0 0 0 15.11 1.71l44.89-18.07a10.81 10.81 0 0 1 13.14 4.58l42.77 74a10.8 10.8 0 0 1-2.45 13.75l-38.21 30a16.05 16.05 0 0 0-6.05 14.08c.33 4.14.55 8.3.55 12.47z",
    fill: "none",
    stroke: "currentColor",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-width": "32"
  },
  null,
  -1
  /* HOISTED */
);
const _hoisted_3$1 = [_hoisted_2$1];
const SettingsOutline = defineComponent({
  name: "SettingsOutline",
  render: function render6(_ctx, _cache) {
    return openBlock(), createElementBlock("svg", _hoisted_1$1, _hoisted_3$1);
  }
});
function useStorage(key, defaultValue = null, options = {}) {
  const {
    immediate = true,
    deep = true,
    onError = (error2) => logger.error(`Storage error for key "${key}":`, error2)
  } = options;
  const data = ref(defaultValue);
  const loading = ref(false);
  const error = ref(null);
  const read = async () => {
    try {
      loading.value = true;
      error.value = null;
      const result = await storage.get([key]);
      data.value = result[key] !== void 0 ? result[key] : defaultValue;
    } catch (err) {
      error.value = err;
      onError(err);
    } finally {
      loading.value = false;
    }
  };
  const write = async (value) => {
    try {
      loading.value = true;
      error.value = null;
      await storage.set({ [key]: value });
      data.value = value;
    } catch (err) {
      error.value = err;
      onError(err);
    } finally {
      loading.value = false;
    }
  };
  const remove = async () => {
    try {
      loading.value = true;
      error.value = null;
      await storage.remove([key]);
      data.value = defaultValue;
    } catch (err) {
      error.value = err;
      onError(err);
    } finally {
      loading.value = false;
    }
  };
  const handleStorageChange = (changes, areaName) => {
    if (areaName === "sync" && changes[key]) {
      const change = changes[key];
      if (change.newValue !== void 0 && change.newValue !== data.value) {
        data.value = change.newValue;
      }
    }
  };
  onMounted(() => {
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }
  });
  onUnmounted(() => {
    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    }
  });
  if (immediate) {
    read();
  }
  watch(
    data,
    (newValue) => {
      if (!loading.value) {
        write(newValue);
      }
    },
    { deep }
  );
  return {
    data,
    loading,
    error,
    read,
    write,
    remove
  };
}
function useCounter(key = "count", initialValue = 0) {
  const { data: count, loading, error } = useStorage(key, initialValue);
  const increment = () => {
    if (!loading.value) {
      count.value = (count.value || 0) + 1;
    }
  };
  const decrement = () => {
    if (!loading.value && count.value > 0) {
      count.value = count.value - 1;
    }
  };
  const reset = () => {
    if (!loading.value) {
      count.value = initialValue;
    }
  };
  const setValue = (value) => {
    if (!loading.value && typeof value === "number" && value >= 0) {
      count.value = value;
    }
  };
  return {
    count,
    loading,
    error,
    increment,
    decrement,
    reset,
    setValue
  };
}
const MESSAGE_TYPES = {
  // 界面操作
  OPEN_SIDEPANEL: "OPEN_SIDEPANEL",
  TOGGLE_OPTIONS: "TOGGLE_OPTIONS"
};
const _sfc_main$1 = {
  __name: "Counter",
  props: {
    title: {
      type: String,
      default: "计数器"
    }
  },
  setup(__props) {
    const { count, increment, decrement, reset, loading } = useCounter("global-counter", 0);
    const openOptions = () => {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.TOGGLE_OPTIONS });
    };
    const openSidePanel = () => {
      chrome.runtime.sendMessage({ type: MESSAGE_TYPES.OPEN_SIDEPANEL });
    };
    return (_ctx, _cache) => {
      const _component_n_number_animation = __unplugin_components_0;
      const _component_n_statistic = __unplugin_components_1;
      const _component_n_icon = NIcon;
      const _component_n_button = Button;
      const _component_n_button_group = __unplugin_components_4;
      const _component_n_divider = __unplugin_components_5;
      const _component_n_space = __unplugin_components_3;
      return openBlock(), createBlock(_component_n_space, {
        vertical: "",
        size: 20,
        align: "center",
        class: "w-full"
      }, {
        default: withCtx(() => [
          createVNode(_component_n_statistic, {
            label: __props.title,
            "tabular-nums": "",
            class: "text-center"
          }, {
            default: withCtx(() => [
              createVNode(_component_n_number_animation, {
                from: 0,
                to: unref(count),
                duration: 300,
                active: true
              }, null, 8, ["to"])
            ]),
            _: 1
          }, 8, ["label"]),
          createVNode(_component_n_button_group, null, {
            default: withCtx(() => [
              createVNode(_component_n_button, {
                type: "success",
                loading: unref(loading),
                onClick: unref(increment),
                strong: ""
              }, {
                icon: withCtx(() => [
                  createVNode(_component_n_icon, null, {
                    default: withCtx(() => [
                      createVNode(unref(AddCircleOutline))
                    ]),
                    _: 1
                  })
                ]),
                default: withCtx(() => [
                  _cache[0] || (_cache[0] = createTextVNode(" 增加 "))
                ]),
                _: 1,
                __: [0]
              }, 8, ["loading", "onClick"]),
              createVNode(_component_n_button, {
                type: "warning",
                loading: unref(loading),
                onClick: unref(decrement),
                strong: ""
              }, {
                icon: withCtx(() => [
                  createVNode(_component_n_icon, null, {
                    default: withCtx(() => [
                      createVNode(unref(RemoveCircleOutline))
                    ]),
                    _: 1
                  })
                ]),
                default: withCtx(() => [
                  _cache[1] || (_cache[1] = createTextVNode(" 减少 "))
                ]),
                _: 1,
                __: [1]
              }, 8, ["loading", "onClick"]),
              createVNode(_component_n_button, {
                type: "info",
                loading: unref(loading),
                onClick: unref(reset),
                strong: ""
              }, {
                icon: withCtx(() => [
                  createVNode(_component_n_icon, null, {
                    default: withCtx(() => [
                      createVNode(unref(RefreshOutline))
                    ]),
                    _: 1
                  })
                ]),
                default: withCtx(() => [
                  _cache[2] || (_cache[2] = createTextVNode(" 重置 "))
                ]),
                _: 1,
                __: [2]
              }, 8, ["loading", "onClick"])
            ]),
            _: 1
          }),
          createVNode(_component_n_divider, { class: "my-2" }),
          createVNode(_component_n_space, { size: 12 }, {
            default: withCtx(() => [
              createVNode(_component_n_button, {
                type: "primary",
                onClick: openSidePanel,
                strong: ""
              }, {
                icon: withCtx(() => [
                  createVNode(_component_n_icon, null, {
                    default: withCtx(() => [
                      createVNode(unref(MenuOutline))
                    ]),
                    _: 1
                  })
                ]),
                default: withCtx(() => [
                  _cache[3] || (_cache[3] = createTextVNode(" 侧边栏 "))
                ]),
                _: 1,
                __: [3]
              }),
              createVNode(_component_n_button, {
                type: "default",
                onClick: openOptions,
                strong: ""
              }, {
                icon: withCtx(() => [
                  createVNode(_component_n_icon, null, {
                    default: withCtx(() => [
                      createVNode(unref(SettingsOutline))
                    ]),
                    _: 1
                  })
                ]),
                default: withCtx(() => [
                  _cache[4] || (_cache[4] = createTextVNode(" 设置 "))
                ]),
                _: 1,
                __: [4]
              })
            ]),
            _: 1
          })
        ]),
        _: 1
      });
    };
  }
};
const _hoisted_1 = { class: "h-screen overflow-y-auto scrollbar-hide from-indigo-50 to-blue-50 bg-gradient-to-b p-6 dark:from-gray-900 dark:to-gray-800" };
const _hoisted_2 = { class: "mx-auto max-w-md" };
const _hoisted_3 = { class: "mb-6 flex items-center justify-between" };
const _hoisted_4 = {
  key: 0,
  class: "mt-1 text-sm text-gray-500 dark:text-gray-400"
};
const _hoisted_5 = { class: "flex items-center justify-between" };
const _hoisted_6 = { class: "flex justify-between" };
const _hoisted_7 = { class: "font-medium" };
const _hoisted_8 = { class: "flex justify-between" };
const _hoisted_9 = { class: "font-medium" };
const _hoisted_10 = { class: "flex justify-between" };
const _hoisted_11 = { class: "text-sm" };
const _sfc_main = {
  __name: "SidePanel",
  setup(__props) {
    const { user, loading, logout } = useAuth();
    const showLogin = ref(false);
    if (!loading.value && !user.value) {
      showLogin.value = true;
    }
    const closeSidePanel = () => {
      window.close();
    };
    const handleLogout = async () => {
      await logout();
    };
    return (_ctx, _cache) => {
      const _component_n_icon = NIcon;
      const _component_n_button = Button;
      const _component_n_card = __unplugin_components_2;
      const _component_n_space = __unplugin_components_3;
      return openBlock(), createElementBlock("div", _hoisted_1, [
        createBaseVNode("div", _hoisted_2, [
          createBaseVNode("div", _hoisted_3, [
            createBaseVNode("div", null, [
              _cache[1] || (_cache[1] = createBaseVNode("h2", { class: "text-2xl text-gray-800 font-bold dark:text-gray-100" }, "SidePanel 页面", -1)),
              unref(user) ? (openBlock(), createElementBlock("p", _hoisted_4, " 欢迎，" + toDisplayString(unref(user).userName), 1)) : createCommentVNode("", true)
            ]),
            createVNode(_component_n_button, {
              text: "",
              circle: "",
              onClick: closeSidePanel,
              title: "关闭侧边栏"
            }, {
              icon: withCtx(() => [
                createVNode(_component_n_icon, { size: 24 }, {
                  default: withCtx(() => [
                    createVNode(unref(CloseOutline))
                  ]),
                  _: 1
                })
              ]),
              _: 1
            })
          ]),
          createVNode(_component_n_card, {
            bordered: false,
            class: "shadow-lg mb-4"
          }, {
            default: withCtx(() => [
              createVNode(_sfc_main$1, { title: "计数器示例" })
            ]),
            _: 1
          }),
          unref(user) ? (openBlock(), createBlock(_component_n_card, {
            key: 0,
            bordered: false,
            class: "shadow-lg"
          }, {
            header: withCtx(() => [
              createBaseVNode("div", _hoisted_5, [
                _cache[3] || (_cache[3] = createBaseVNode("span", null, "用户信息", -1)),
                createVNode(_component_n_button, {
                  size: "small",
                  onClick: handleLogout
                }, {
                  default: withCtx(() => _cache[2] || (_cache[2] = [
                    createTextVNode(" 退出登录 ")
                  ])),
                  _: 1,
                  __: [2]
                })
              ])
            ]),
            default: withCtx(() => [
              createVNode(_component_n_space, {
                vertical: "",
                size: 12
              }, {
                default: withCtx(() => [
                  createBaseVNode("div", _hoisted_6, [
                    _cache[4] || (_cache[4] = createBaseVNode("span", { class: "text-gray-600 dark:text-gray-400" }, "用户 ID：", -1)),
                    createBaseVNode("span", _hoisted_7, toDisplayString(unref(user).userId), 1)
                  ]),
                  createBaseVNode("div", _hoisted_8, [
                    _cache[5] || (_cache[5] = createBaseVNode("span", { class: "text-gray-600 dark:text-gray-400" }, "用户名：", -1)),
                    createBaseVNode("span", _hoisted_9, toDisplayString(unref(user).userName), 1)
                  ]),
                  createBaseVNode("div", _hoisted_10, [
                    _cache[6] || (_cache[6] = createBaseVNode("span", { class: "text-gray-600 dark:text-gray-400" }, "登录时间：", -1)),
                    createBaseVNode("span", _hoisted_11, toDisplayString(unref(user).loginTime ? new Date(unref(user).loginTime).toLocaleString() : "-"), 1)
                  ])
                ]),
                _: 1
              })
            ]),
            _: 1
          })) : createCommentVNode("", true),
          createVNode(_sfc_main$2, {
            show: showLogin.value,
            "onUpdate:show": _cache[0] || (_cache[0] = ($event) => showLogin.value = $event)
          }, null, 8, ["show"])
        ])
      ]);
    };
  }
};
createApp(_sfc_main).mount("#app");
