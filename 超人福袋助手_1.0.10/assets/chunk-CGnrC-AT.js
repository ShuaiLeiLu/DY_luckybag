import { bi as derived, bj as changeColor, bk as createInjectionKey, a_ as h, bl as c, bm as cB, bn as insideModal, bo as insidePopover, bp as cM, bq as cE, br as iconSwitchTransition, d as defineComponent, bs as resolveWrappedSlot, bt as NIconSwitchTransition, bu as on, q as inject, r as ref, bv as useConfig, ay as toRef, bw as useMergedState, bx as useMemo, by as useFormItem, bz as useTheme, bA as useRtl, s as computed, bB as createKey, bC as useThemeClass, bD as createId, bE as call, bF as createDiscreteApi, c as createElementBlock, f as openBlock, ar as createBaseVNode, l as createVNode, aA as withCtx, aE as createTextVNode, bG as Button, bH as __unplugin_components_2, bf as createApp } from "./chunk-CJtm-jMm.js";
import { _ as __unplugin_components_3 } from "./chunk-Buj9EapW.js";
const commonVariables = {
  sizeSmall: "14px",
  sizeMedium: "16px",
  sizeLarge: "18px",
  labelPadding: "0 8px",
  labelFontWeight: "400"
};
function self(vars) {
  const {
    baseColor,
    inputColorDisabled,
    cardColor,
    modalColor,
    popoverColor,
    textColorDisabled,
    borderColor,
    primaryColor,
    textColor2,
    fontSizeSmall,
    fontSizeMedium,
    fontSizeLarge,
    borderRadiusSmall,
    lineHeight
  } = vars;
  return Object.assign(Object.assign({}, commonVariables), {
    labelLineHeight: lineHeight,
    fontSizeSmall,
    fontSizeMedium,
    fontSizeLarge,
    borderRadius: borderRadiusSmall,
    color: baseColor,
    colorChecked: primaryColor,
    colorDisabled: inputColorDisabled,
    colorDisabledChecked: inputColorDisabled,
    colorTableHeader: cardColor,
    colorTableHeaderModal: modalColor,
    colorTableHeaderPopover: popoverColor,
    checkMarkColor: baseColor,
    checkMarkColorDisabled: textColorDisabled,
    checkMarkColorDisabledChecked: textColorDisabled,
    border: `1px solid ${borderColor}`,
    borderDisabled: `1px solid ${borderColor}`,
    borderDisabledChecked: `1px solid ${borderColor}`,
    borderChecked: `1px solid ${primaryColor}`,
    borderFocus: `1px solid ${primaryColor}`,
    boxShadowFocus: `0 0 0 2px ${changeColor(primaryColor, {
      alpha: 0.3
    })}`,
    textColor: textColor2,
    textColorDisabled
  });
}
const checkboxLight = {
  common: derived,
  self
};
const checkboxGroupInjectionKey = createInjectionKey("n-checkbox-group");
const renderCheckMark = () => h("svg", {
  viewBox: "0 0 64 64",
  class: "check-icon"
}, h("path", {
  d: "M50.42,16.76L22.34,39.45l-8.1-11.46c-1.12-1.58-3.3-1.96-4.88-0.84c-1.58,1.12-1.95,3.3-0.84,4.88l10.26,14.51  c0.56,0.79,1.42,1.31,2.38,1.45c0.16,0.02,0.32,0.03,0.48,0.03c0.8,0,1.57-0.27,2.2-0.78l30.99-25.03c1.5-1.21,1.74-3.42,0.52-4.92  C54.13,15.78,51.93,15.55,50.42,16.76z"
}));
const renderLineMark = () => h("svg", {
  viewBox: "0 0 100 100",
  class: "line-icon"
}, h("path", {
  d: "M80.2,55.5H21.4c-2.8,0-5.1-2.5-5.1-5.5l0,0c0-3,2.3-5.5,5.1-5.5h58.7c2.8,0,5.1,2.5,5.1,5.5l0,0C85.2,53.1,82.9,55.5,80.2,55.5z"
}));
const style = c([
  cB("checkbox", `
 font-size: var(--n-font-size);
 outline: none;
 cursor: pointer;
 display: inline-flex;
 flex-wrap: nowrap;
 align-items: flex-start;
 word-break: break-word;
 line-height: var(--n-size);
 --n-merged-color-table: var(--n-color-table);
 `, [cM("show-label", "line-height: var(--n-label-line-height);"), c("&:hover", [cB("checkbox-box", [cE("border", "border: var(--n-border-checked);")])]), c("&:focus:not(:active)", [cB("checkbox-box", [cE("border", `
 border: var(--n-border-focus);
 box-shadow: var(--n-box-shadow-focus);
 `)])]), cM("inside-table", [cB("checkbox-box", `
 background-color: var(--n-merged-color-table);
 `)]), cM("checked", [cB("checkbox-box", `
 background-color: var(--n-color-checked);
 `, [cB("checkbox-icon", [
    // if not set width to 100%, safari & old chrome won't display the icon
    c(".check-icon", `
 opacity: 1;
 transform: scale(1);
 `)
  ])])]), cM("indeterminate", [cB("checkbox-box", [cB("checkbox-icon", [c(".check-icon", `
 opacity: 0;
 transform: scale(.5);
 `), c(".line-icon", `
 opacity: 1;
 transform: scale(1);
 `)])])]), cM("checked, indeterminate", [c("&:focus:not(:active)", [cB("checkbox-box", [cE("border", `
 border: var(--n-border-checked);
 box-shadow: var(--n-box-shadow-focus);
 `)])]), cB("checkbox-box", `
 background-color: var(--n-color-checked);
 border-left: 0;
 border-top: 0;
 `, [cE("border", {
    border: "var(--n-border-checked)"
  })])]), cM("disabled", {
    cursor: "not-allowed"
  }, [cM("checked", [cB("checkbox-box", `
 background-color: var(--n-color-disabled-checked);
 `, [cE("border", {
    border: "var(--n-border-disabled-checked)"
  }), cB("checkbox-icon", [c(".check-icon, .line-icon", {
    fill: "var(--n-check-mark-color-disabled-checked)"
  })])])]), cB("checkbox-box", `
 background-color: var(--n-color-disabled);
 `, [cE("border", `
 border: var(--n-border-disabled);
 `), cB("checkbox-icon", [c(".check-icon, .line-icon", `
 fill: var(--n-check-mark-color-disabled);
 `)])]), cE("label", `
 color: var(--n-text-color-disabled);
 `)]), cB("checkbox-box-wrapper", `
 position: relative;
 width: var(--n-size);
 flex-shrink: 0;
 flex-grow: 0;
 user-select: none;
 -webkit-user-select: none;
 `), cB("checkbox-box", `
 position: absolute;
 left: 0;
 top: 50%;
 transform: translateY(-50%);
 height: var(--n-size);
 width: var(--n-size);
 display: inline-block;
 box-sizing: border-box;
 border-radius: var(--n-border-radius);
 background-color: var(--n-color);
 transition: background-color 0.3s var(--n-bezier);
 `, [cE("border", `
 transition:
 border-color .3s var(--n-bezier),
 box-shadow .3s var(--n-bezier);
 border-radius: inherit;
 position: absolute;
 left: 0;
 right: 0;
 top: 0;
 bottom: 0;
 border: var(--n-border);
 `), cB("checkbox-icon", `
 display: flex;
 align-items: center;
 justify-content: center;
 position: absolute;
 left: 1px;
 right: 1px;
 top: 1px;
 bottom: 1px;
 `, [c(".check-icon, .line-icon", `
 width: 100%;
 fill: var(--n-check-mark-color);
 opacity: 0;
 transform: scale(0.5);
 transform-origin: center;
 transition:
 fill 0.3s var(--n-bezier),
 transform 0.3s var(--n-bezier),
 opacity 0.3s var(--n-bezier),
 border-color 0.3s var(--n-bezier);
 `), iconSwitchTransition({
    left: "1px",
    top: "1px"
  })])]), cE("label", `
 color: var(--n-text-color);
 transition: color .3s var(--n-bezier);
 user-select: none;
 -webkit-user-select: none;
 padding: var(--n-label-padding);
 font-weight: var(--n-label-font-weight);
 `, [c("&:empty", {
    display: "none"
  })])]),
  // modal table header checkbox
  insideModal(cB("checkbox", `
 --n-merged-color-table: var(--n-color-table-modal);
 `)),
  // popover table header checkbox
  insidePopover(cB("checkbox", `
 --n-merged-color-table: var(--n-color-table-popover);
 `))
]);
const checkboxProps = Object.assign(Object.assign({}, useTheme.props), {
  size: String,
  checked: {
    type: [Boolean, String, Number],
    default: void 0
  },
  defaultChecked: {
    type: [Boolean, String, Number],
    default: false
  },
  value: [String, Number],
  disabled: {
    type: Boolean,
    default: void 0
  },
  indeterminate: Boolean,
  label: String,
  focusable: {
    type: Boolean,
    default: true
  },
  checkedValue: {
    type: [Boolean, String, Number],
    default: true
  },
  uncheckedValue: {
    type: [Boolean, String, Number],
    default: false
  },
  "onUpdate:checked": [Function, Array],
  onUpdateChecked: [Function, Array],
  // private
  privateInsideTable: Boolean,
  // deprecated
  onChange: [Function, Array]
});
const __unplugin_components_0 = defineComponent({
  name: "Checkbox",
  props: checkboxProps,
  setup(props) {
    const NCheckboxGroup = inject(checkboxGroupInjectionKey, null);
    const selfRef = ref(null);
    const {
      mergedClsPrefixRef,
      inlineThemeDisabled,
      mergedRtlRef
    } = useConfig(props);
    const uncontrolledCheckedRef = ref(props.defaultChecked);
    const controlledCheckedRef = toRef(props, "checked");
    const mergedCheckedRef = useMergedState(controlledCheckedRef, uncontrolledCheckedRef);
    const renderedCheckedRef = useMemo(() => {
      if (NCheckboxGroup) {
        const groupValueSet = NCheckboxGroup.valueSetRef.value;
        if (groupValueSet && props.value !== void 0) {
          return groupValueSet.has(props.value);
        }
        return false;
      } else {
        return mergedCheckedRef.value === props.checkedValue;
      }
    });
    const formItem = useFormItem(props, {
      mergedSize(NFormItem) {
        const {
          size
        } = props;
        if (size !== void 0) return size;
        if (NCheckboxGroup) {
          const {
            value: mergedSize
          } = NCheckboxGroup.mergedSizeRef;
          if (mergedSize !== void 0) {
            return mergedSize;
          }
        }
        if (NFormItem) {
          const {
            mergedSize
          } = NFormItem;
          if (mergedSize !== void 0) return mergedSize.value;
        }
        return "medium";
      },
      mergedDisabled(NFormItem) {
        const {
          disabled
        } = props;
        if (disabled !== void 0) return disabled;
        if (NCheckboxGroup) {
          if (NCheckboxGroup.disabledRef.value) return true;
          const {
            maxRef: {
              value: max
            },
            checkedCountRef
          } = NCheckboxGroup;
          if (max !== void 0 && checkedCountRef.value >= max && !renderedCheckedRef.value) {
            return true;
          }
          const {
            minRef: {
              value: min
            }
          } = NCheckboxGroup;
          if (min !== void 0 && checkedCountRef.value <= min && renderedCheckedRef.value) {
            return true;
          }
        }
        if (NFormItem) {
          return NFormItem.disabled.value;
        }
        return false;
      }
    });
    const {
      mergedDisabledRef,
      mergedSizeRef
    } = formItem;
    const themeRef = useTheme("Checkbox", "-checkbox", style, checkboxLight, props, mergedClsPrefixRef);
    function toggle(e) {
      if (NCheckboxGroup && props.value !== void 0) {
        NCheckboxGroup.toggleCheckbox(!renderedCheckedRef.value, props.value);
      } else {
        const {
          onChange,
          "onUpdate:checked": _onUpdateCheck,
          onUpdateChecked
        } = props;
        const {
          nTriggerFormInput,
          nTriggerFormChange
        } = formItem;
        const nextChecked = renderedCheckedRef.value ? props.uncheckedValue : props.checkedValue;
        if (_onUpdateCheck) {
          call(_onUpdateCheck, nextChecked, e);
        }
        if (onUpdateChecked) {
          call(onUpdateChecked, nextChecked, e);
        }
        if (onChange) call(onChange, nextChecked, e);
        nTriggerFormInput();
        nTriggerFormChange();
        uncontrolledCheckedRef.value = nextChecked;
      }
    }
    function handleClick(e) {
      if (!mergedDisabledRef.value) {
        toggle(e);
      }
    }
    function handleKeyUp(e) {
      if (mergedDisabledRef.value) return;
      switch (e.key) {
        case " ":
        case "Enter":
          toggle(e);
      }
    }
    function handleKeyDown(e) {
      switch (e.key) {
        case " ":
          e.preventDefault();
      }
    }
    const exposedMethods = {
      focus: () => {
        var _a;
        (_a = selfRef.value) === null || _a === void 0 ? void 0 : _a.focus();
      },
      blur: () => {
        var _a;
        (_a = selfRef.value) === null || _a === void 0 ? void 0 : _a.blur();
      }
    };
    const rtlEnabledRef = useRtl("Checkbox", mergedRtlRef, mergedClsPrefixRef);
    const cssVarsRef = computed(() => {
      const {
        value: mergedSize
      } = mergedSizeRef;
      const {
        common: {
          cubicBezierEaseInOut
        },
        self: {
          borderRadius,
          color,
          colorChecked,
          colorDisabled,
          colorTableHeader,
          colorTableHeaderModal,
          colorTableHeaderPopover,
          checkMarkColor,
          checkMarkColorDisabled,
          border,
          borderFocus,
          borderDisabled,
          borderChecked,
          boxShadowFocus,
          textColor,
          textColorDisabled,
          checkMarkColorDisabledChecked,
          colorDisabledChecked,
          borderDisabledChecked,
          labelPadding,
          labelLineHeight,
          labelFontWeight,
          [createKey("fontSize", mergedSize)]: fontSize,
          [createKey("size", mergedSize)]: size
        }
      } = themeRef.value;
      return {
        "--n-label-line-height": labelLineHeight,
        "--n-label-font-weight": labelFontWeight,
        "--n-size": size,
        "--n-bezier": cubicBezierEaseInOut,
        "--n-border-radius": borderRadius,
        "--n-border": border,
        "--n-border-checked": borderChecked,
        "--n-border-focus": borderFocus,
        "--n-border-disabled": borderDisabled,
        "--n-border-disabled-checked": borderDisabledChecked,
        "--n-box-shadow-focus": boxShadowFocus,
        "--n-color": color,
        "--n-color-checked": colorChecked,
        "--n-color-table": colorTableHeader,
        "--n-color-table-modal": colorTableHeaderModal,
        "--n-color-table-popover": colorTableHeaderPopover,
        "--n-color-disabled": colorDisabled,
        "--n-color-disabled-checked": colorDisabledChecked,
        "--n-text-color": textColor,
        "--n-text-color-disabled": textColorDisabled,
        "--n-check-mark-color": checkMarkColor,
        "--n-check-mark-color-disabled": checkMarkColorDisabled,
        "--n-check-mark-color-disabled-checked": checkMarkColorDisabledChecked,
        "--n-font-size": fontSize,
        "--n-label-padding": labelPadding
      };
    });
    const themeClassHandle = inlineThemeDisabled ? useThemeClass("checkbox", computed(() => mergedSizeRef.value[0]), cssVarsRef, props) : void 0;
    return Object.assign(formItem, exposedMethods, {
      rtlEnabled: rtlEnabledRef,
      selfRef,
      mergedClsPrefix: mergedClsPrefixRef,
      mergedDisabled: mergedDisabledRef,
      renderedChecked: renderedCheckedRef,
      mergedTheme: themeRef,
      labelId: createId(),
      handleClick,
      handleKeyUp,
      handleKeyDown,
      cssVars: inlineThemeDisabled ? void 0 : cssVarsRef,
      themeClass: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.themeClass,
      onRender: themeClassHandle === null || themeClassHandle === void 0 ? void 0 : themeClassHandle.onRender
    });
  },
  render() {
    var _a;
    const {
      $slots,
      renderedChecked,
      mergedDisabled,
      indeterminate,
      privateInsideTable,
      cssVars,
      labelId,
      label,
      mergedClsPrefix,
      focusable,
      handleKeyUp,
      handleKeyDown,
      handleClick
    } = this;
    (_a = this.onRender) === null || _a === void 0 ? void 0 : _a.call(this);
    const labelNode = resolveWrappedSlot($slots.default, (children) => {
      if (label || children) {
        return h("span", {
          class: `${mergedClsPrefix}-checkbox__label`,
          id: labelId
        }, label || children);
      }
      return null;
    });
    return h("div", {
      ref: "selfRef",
      class: [`${mergedClsPrefix}-checkbox`, this.themeClass, this.rtlEnabled && `${mergedClsPrefix}-checkbox--rtl`, renderedChecked && `${mergedClsPrefix}-checkbox--checked`, mergedDisabled && `${mergedClsPrefix}-checkbox--disabled`, indeterminate && `${mergedClsPrefix}-checkbox--indeterminate`, privateInsideTable && `${mergedClsPrefix}-checkbox--inside-table`, labelNode && `${mergedClsPrefix}-checkbox--show-label`],
      tabindex: mergedDisabled || !focusable ? void 0 : 0,
      role: "checkbox",
      "aria-checked": indeterminate ? "mixed" : renderedChecked,
      "aria-labelledby": labelId,
      style: cssVars,
      onKeyup: handleKeyUp,
      onKeydown: handleKeyDown,
      onClick: handleClick,
      onMousedown: () => {
        on("selectstart", window, (e) => {
          e.preventDefault();
        }, {
          once: true
        });
      }
    }, h("div", {
      class: `${mergedClsPrefix}-checkbox-box-wrapper`
    }, " ", h("div", {
      class: `${mergedClsPrefix}-checkbox-box`
    }, h(NIconSwitchTransition, null, {
      default: () => this.indeterminate ? h("div", {
        key: "indeterminate",
        class: `${mergedClsPrefix}-checkbox-icon`
      }, renderLineMark()) : h("div", {
        key: "check",
        class: `${mergedClsPrefix}-checkbox-icon`
      }, renderCheckMark())
    }), h("div", {
      class: `${mergedClsPrefix}-checkbox-box__border`
    }))), labelNode);
  }
});
const _hoisted_1 = { class: "w-400px h-[240px] from-blue-50 to-purple-50 bg-gradient-to-br p-5 dark:from-gray-900 dark:to-gray-800" };
const _hoisted_2 = { class: "flex items-center justify-between" };
const _sfc_main = {
  __name: "Popup",
  setup(__props) {
    const { message } = createDiscreteApi(["message"]);
    const checked = ref(true);
    const goToOptionsPage = () => {
      if (!checked.value) {
        message.error("请先阅读并同意条款");
        return;
      }
      chrome.tabs.create({
        url: chrome.runtime.getURL("/src/render/views/options/options.html"),
        active: true
      });
    };
    return (_ctx, _cache) => {
      const _component_n_checkbox = __unplugin_components_0;
      const _component_n_button = Button;
      const _component_n_space = __unplugin_components_3;
      const _component_n_card = __unplugin_components_2;
      return openBlock(), createElementBlock("div", _hoisted_1, [
        _cache[4] || (_cache[4] = createBaseVNode("div", { class: "mb-4 text-center" }, [
          createBaseVNode("h2", { class: "m-0 text-lg text-gray-800 font-semibold dark:text-gray-100" }, "超人福袋助手")
        ], -1)),
        createVNode(_component_n_card, {
          size: "small",
          bordered: false,
          class: "shadow-sm px-2 py-1"
        }, {
          default: withCtx(() => [
            createVNode(_component_n_space, {
              vertical: "",
              class: "flex items-center"
            }, {
              default: withCtx(() => [
                _cache[3] || (_cache[3] = createBaseVNode("p", null, " 本插件仅用于学习与研究目的，严禁用于商业及其他盈利性场景。使用本工具需严格遵守相关平台服务条款与法律法规，因违规使用或操作不当引发的任何纠纷、损失，开发者不承担任何责任。 ", -1)),
                createBaseVNode("div", _hoisted_2, [
                  createVNode(_component_n_checkbox, {
                    checked: checked.value,
                    "onUpdate:checked": _cache[0] || (_cache[0] = ($event) => checked.value = $event),
                    class: "mr-20"
                  }, {
                    default: withCtx(() => _cache[1] || (_cache[1] = [
                      createTextVNode("我已阅读并同意以上条款")
                    ])),
                    _: 1,
                    __: [1]
                  }, 8, ["checked"]),
                  createVNode(_component_n_button, {
                    type: "primary",
                    onClick: goToOptionsPage
                  }, {
                    default: withCtx(() => _cache[2] || (_cache[2] = [
                      createTextVNode("前往主页")
                    ])),
                    _: 1,
                    __: [2]
                  })
                ])
              ]),
              _: 1,
              __: [3]
            })
          ]),
          _: 1
        })
      ]);
    };
  }
};
createApp(_sfc_main).mount("#app");
