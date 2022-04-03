"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addAPI = exports.addCustomMethods = void 0;
const util_1 = require("util");
const lodash_1 = require("lodash");
const builder_symbol_1 = __importDefault(require("../builder-symbol"));
const snapshot_properties_1 = require("./snapshot-properties");
const get_callsite_1 = require("../../errors/get-callsite");
const client_function_builder_1 = __importDefault(require("../client-function-builder"));
const re_executable_promise_1 = __importDefault(require("../../utils/re-executable-promise"));
const type_assertions_1 = require("../../errors/runtime/type-assertions");
const make_reg_exp_1 = __importDefault(require("../../utils/make-reg-exp"));
const selector_text_filter_1 = __importDefault(require("./selector-text-filter"));
const selector_attribute_filter_1 = __importDefault(require("./selector-attribute-filter"));
const prepare_api_args_1 = __importDefault(require("./prepare-api-args"));
const VISIBLE_PROP_NAME = 'visible';
const SNAPSHOT_PROP_PRIMITIVE = `[object ${re_executable_promise_1.default.name}]`;
const filterNodes = (new client_function_builder_1.default((nodes, filter, querySelectorRoot, originNode, ...filterArgs) => {
    if (typeof filter === 'number') {
        const matchingNode = filter < 0 ? nodes[nodes.length + filter] : nodes[filter];
        return matchingNode ? [matchingNode] : [];
    }
    const result = [];
    if (typeof filter === 'string') {
        // NOTE: we can search for elements only in document or element.
        if (querySelectorRoot.nodeType !== 1 && querySelectorRoot.nodeType !== 9)
            return null;
        const matching = querySelectorRoot.querySelectorAll(filter);
        const matchingArr = [];
        for (let i = 0; i < matching.length; i++)
            matchingArr.push(matching[i]);
        filter = node => matchingArr.indexOf(node) > -1;
    }
    if (typeof filter === 'function') {
        for (let j = 0; j < nodes.length; j++) {
            if (filter(nodes[j], j, originNode, ...filterArgs))
                result.push(nodes[j]);
        }
    }
    return result;
})).getFunction();
const expandSelectorResults = (new client_function_builder_1.default((selector, populateDerivativeNodes) => {
    const nodes = selector();
    if (!nodes.length)
        return null;
    const result = [];
    for (let i = 0; i < nodes.length; i++) {
        const derivativeNodes = populateDerivativeNodes(nodes[i]);
        if (derivativeNodes) {
            for (let j = 0; j < derivativeNodes.length; j++) {
                if (result.indexOf(derivativeNodes[j]) < 0)
                    result.push(derivativeNodes[j]);
            }
        }
    }
    return result;
})).getFunction();
async function getSnapshot(getSelector, callsite, SelectorBuilder, getVisibleValueMode) {
    let node = null;
    const selector = new SelectorBuilder(getSelector(), { getVisibleValueMode, needError: true }, { instantiation: 'Selector' }).getFunction();
    try {
        node = await selector();
    }
    catch (err) {
        err.callsite = callsite;
        throw err;
    }
    return node;
}
function assertAddCustomDOMPropertiesOptions(properties) {
    type_assertions_1.assertType(type_assertions_1.is.nonNullObject, 'addCustomDOMProperties', '"addCustomDOMProperties" option', properties);
    Object.keys(properties).forEach(prop => {
        type_assertions_1.assertType(type_assertions_1.is.function, 'addCustomDOMProperties', `Custom DOM properties method '${prop}'`, properties[prop]);
    });
}
function assertAddCustomMethods(properties, opts) {
    type_assertions_1.assertType(type_assertions_1.is.nonNullObject, 'addCustomMethods', '"addCustomMethods" option', properties);
    if (opts !== void 0)
        type_assertions_1.assertType(type_assertions_1.is.nonNullObject, 'addCustomMethods', '"addCustomMethods" option', opts);
    Object.keys(properties).forEach(prop => {
        type_assertions_1.assertType(type_assertions_1.is.function, 'addCustomMethods', `Custom method '${prop}'`, properties[prop]);
    });
}
function getDerivativeSelectorArgs(options, selectorFn, apiFn, filter, additionalDependencies) {
    return Object.assign({}, options, { selectorFn, apiFn, filter, additionalDependencies });
}
function createPrimitiveGetterWrapper(observedCallsites, callsite) {
    return () => {
        if (observedCallsites)
            observedCallsites.unawaitedSnapshotCallsites.add(callsite);
        return SNAPSHOT_PROP_PRIMITIVE;
    };
}
function addSnapshotProperties(obj, getSelector, SelectorBuilder, properties, observedCallsites) {
    properties.forEach(prop => {
        Object.defineProperty(obj, prop, {
            get: () => {
                const callsite = get_callsite_1.getCallsiteForMethod('get');
                const propertyPromise = re_executable_promise_1.default.fromFn(async () => {
                    const snapshot = await getSnapshot(getSelector, callsite, SelectorBuilder);
                    return snapshot[prop];
                });
                const primitiveGetterWrapper = createPrimitiveGetterWrapper(observedCallsites, callsite);
                propertyPromise[Symbol.toPrimitive] = primitiveGetterWrapper;
                propertyPromise[util_1.inspect.custom] = primitiveGetterWrapper;
                propertyPromise.then = function (onFulfilled, onRejected) {
                    if (observedCallsites) {
                        observedCallsites.snapshotPropertyCallsites.add(callsite);
                        observedCallsites.unawaitedSnapshotCallsites.delete(callsite);
                    }
                    this._ensureExecuting();
                    return this._taskPromise.then(onFulfilled, onRejected);
                };
                return propertyPromise;
            }
        });
    });
}
function addVisibleProperty({ obj, getSelector, SelectorBuilder }) {
    Object.defineProperty(obj, VISIBLE_PROP_NAME, {
        get: () => {
            const callsite = get_callsite_1.getCallsiteForMethod('get');
            return re_executable_promise_1.default.fromFn(async () => {
                const snapshot = await getSnapshot(getSelector, callsite, SelectorBuilder, true);
                return !!snapshot && snapshot[VISIBLE_PROP_NAME];
            });
        }
    });
}
function addCustomMethods(obj, getSelector, SelectorBuilder, customMethods) {
    const customMethodProps = customMethods ? Object.keys(customMethods) : [];
    customMethodProps.forEach(prop => {
        const { returnDOMNodes = false, method } = customMethods[prop];
        const dependencies = {
            customMethod: method,
            selector: getSelector()
        };
        const callsiteNames = { instantiation: prop };
        if (returnDOMNodes) {
            obj[prop] = (...args) => {
                const selectorFn = () => {
                    /* eslint-disable no-undef */
                    const nodes = selector();
                    return customMethod.apply(customMethod, [nodes].concat(args));
                    /* eslint-enable no-undef */
                };
                const apiFn = prepare_api_args_1.default(prop, ...args);
                const filter = () => true;
                const additionalDependencies = {
                    args,
                    customMethod: method
                };
                return createDerivativeSelectorWithFilter({ getSelector, SelectorBuilder, selectorFn, apiFn, filter, additionalDependencies });
            };
        }
        else {
            obj[prop] = (new client_function_builder_1.default((...args) => {
                /* eslint-disable no-undef */
                const node = selector();
                return customMethod.apply(customMethod, [node].concat(args));
                /* eslint-enable no-undef */
            }, { dependencies }, callsiteNames)).getFunction();
        }
    });
}
exports.addCustomMethods = addCustomMethods;
function prepareSnapshotPropertyList(customDOMProperties) {
    let properties = [...snapshot_properties_1.SNAPSHOT_PROPERTIES];
    // NOTE: The 'visible' snapshot property has a separate handler.
    lodash_1.pull(properties, VISIBLE_PROP_NAME);
    if (customDOMProperties)
        properties = properties.concat(Object.keys(customDOMProperties));
    return properties;
}
function addSnapshotPropertyShorthands({ obj, getSelector, SelectorBuilder, customDOMProperties, customMethods, observedCallsites }) {
    const properties = prepareSnapshotPropertyList(customDOMProperties);
    addSnapshotProperties(obj, getSelector, SelectorBuilder, properties, observedCallsites);
    addCustomMethods(obj, getSelector, SelectorBuilder, customMethods);
    obj.getStyleProperty = prop => {
        const callsite = get_callsite_1.getCallsiteForMethod('getStyleProperty');
        return re_executable_promise_1.default.fromFn(async () => {
            const snapshot = await getSnapshot(getSelector, callsite, SelectorBuilder);
            return snapshot.style ? snapshot.style[prop] : void 0;
        });
    };
    obj.getAttribute = attrName => {
        const callsite = get_callsite_1.getCallsiteForMethod('getAttribute');
        return re_executable_promise_1.default.fromFn(async () => {
            const snapshot = await getSnapshot(getSelector, callsite, SelectorBuilder);
            return snapshot.attributes ? snapshot.attributes[attrName] : void 0;
        });
    };
    obj.hasAttribute = attrName => {
        const callsite = get_callsite_1.getCallsiteForMethod('hasAttribute');
        return re_executable_promise_1.default.fromFn(async () => {
            const snapshot = await getSnapshot(getSelector, callsite, SelectorBuilder);
            return snapshot.attributes ? snapshot.attributes.hasOwnProperty(attrName) : false;
        });
    };
    obj.getBoundingClientRectProperty = prop => {
        const callsite = get_callsite_1.getCallsiteForMethod('getBoundingClientRectProperty');
        return re_executable_promise_1.default.fromFn(async () => {
            const snapshot = await getSnapshot(getSelector, callsite, SelectorBuilder);
            return snapshot.boundingClientRect ? snapshot.boundingClientRect[prop] : void 0;
        });
    };
    obj.hasClass = name => {
        const callsite = get_callsite_1.getCallsiteForMethod('hasClass');
        return re_executable_promise_1.default.fromFn(async () => {
            const snapshot = await getSnapshot(getSelector, callsite, SelectorBuilder);
            return snapshot.classNames ? snapshot.classNames.indexOf(name) > -1 : false;
        });
    };
}
function createCounter(getSelector, SelectorBuilder) {
    const builder = new SelectorBuilder(getSelector(), { counterMode: true }, { instantiation: 'Selector' });
    const counter = builder.getFunction();
    const callsite = get_callsite_1.getCallsiteForMethod('get');
    return async () => {
        try {
            return await counter();
        }
        catch (err) {
            err.callsite = callsite;
            throw err;
        }
    };
}
function addCounterProperties({ obj, getSelector, SelectorBuilder }) {
    Object.defineProperty(obj, 'count', {
        get: () => {
            const counter = createCounter(getSelector, SelectorBuilder);
            return re_executable_promise_1.default.fromFn(() => counter());
        }
    });
    Object.defineProperty(obj, 'exists', {
        get: () => {
            const counter = createCounter(getSelector, SelectorBuilder);
            return re_executable_promise_1.default.fromFn(async () => await counter() > 0);
        }
    });
}
function convertFilterToClientFunctionIfNecessary(callsiteName, filter, dependencies) {
    if (typeof filter === 'function') {
        const builder = filter[builder_symbol_1.default];
        const fn = builder ? builder.fn : filter;
        const options = builder ? lodash_1.assign({}, builder.options, { dependencies }) : { dependencies };
        return (new client_function_builder_1.default(fn, options, { instantiation: callsiteName })).getFunction();
    }
    return filter;
}
function createDerivativeSelectorWithFilter({ getSelector, SelectorBuilder, selectorFn, apiFn, filter, additionalDependencies }) {
    const collectionModeSelectorBuilder = new SelectorBuilder(getSelector(), { collectionMode: true });
    const customDOMProperties = collectionModeSelectorBuilder.options.customDOMProperties;
    const customMethods = collectionModeSelectorBuilder.options.customMethods;
    let dependencies = {
        selector: collectionModeSelectorBuilder.getFunction(),
        filter: filter,
        filterNodes: filterNodes
    };
    const { boundTestRun, timeout, visibilityCheck, apiFnChain } = collectionModeSelectorBuilder.options;
    dependencies = lodash_1.assign(dependencies, additionalDependencies);
    const builder = new SelectorBuilder(selectorFn, {
        dependencies,
        customDOMProperties,
        customMethods,
        boundTestRun,
        timeout,
        visibilityCheck,
        apiFnChain,
        apiFn
    }, { instantiation: 'Selector' });
    return builder.getFunction();
}
const filterByText = convertFilterToClientFunctionIfNecessary('filter', selector_text_filter_1.default);
const filterByAttr = convertFilterToClientFunctionIfNecessary('filter', selector_attribute_filter_1.default);
function ensureRegExpContext(str) {
    // NOTE: if a regexp is created in a separate context (via the 'vm' module) we
    // should wrap it with new RegExp() to make the `instanceof RegExp` check successful.
    if (typeof str !== 'string' && !(str instanceof RegExp))
        return new RegExp(str);
    return str;
}
function addFilterMethods(options) {
    const { obj, getSelector, SelectorBuilder } = options;
    obj.nth = index => {
        type_assertions_1.assertType(type_assertions_1.is.number, 'nth', '"index" argument', index);
        const apiFn = prepare_api_args_1.default('nth', index);
        const builder = new SelectorBuilder(getSelector(), { index, apiFn }, { instantiation: 'Selector' });
        return builder.getFunction();
    };
    obj.withText = text => {
        type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.regExp], 'withText', '"text" argument', text);
        const apiFn = prepare_api_args_1.default('withText', text);
        text = ensureRegExpContext(text);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            const nodes = selector();
            if (!nodes.length)
                return null;
            return filterNodes(nodes, filter, document, void 0, textRe);
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filterByText, { textRe: make_reg_exp_1.default(text) });
        return createDerivativeSelectorWithFilter(args);
    };
    obj.withExactText = text => {
        type_assertions_1.assertType(type_assertions_1.is.string, 'withExactText', '"text" argument', text);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            const nodes = selector();
            if (!nodes.length)
                return null;
            return filterNodes(nodes, filter, document, void 0, exactText);
            /* eslint-enable no-undef */
        };
        const apiFn = prepare_api_args_1.default('withExactText', text);
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filterByText, { exactText: text });
        return createDerivativeSelectorWithFilter(args);
    };
    obj.withAttribute = (attrName, attrValue) => {
        type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.regExp], 'withAttribute', '"attrName" argument', attrName);
        const apiFn = prepare_api_args_1.default('withAttribute', attrName, attrValue);
        attrName = ensureRegExpContext(attrName);
        if (attrValue !== void 0) {
            type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.regExp], 'withAttribute', '"attrValue" argument', attrValue);
            attrValue = ensureRegExpContext(attrValue);
        }
        const selectorFn = () => {
            /* eslint-disable no-undef */
            const nodes = selector();
            if (!nodes.length)
                return null;
            return filterNodes(nodes, filter, document, void 0, attrName, attrValue);
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filterByAttr, {
            attrName,
            attrValue
        });
        return createDerivativeSelectorWithFilter(args);
    };
    obj.filter = (filter, dependencies) => {
        type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.function], 'filter', '"filter" argument', filter);
        const apiFn = prepare_api_args_1.default('filter', filter);
        filter = convertFilterToClientFunctionIfNecessary('filter', filter, dependencies);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            const nodes = selector();
            if (!nodes.length)
                return null;
            return filterNodes(nodes, filter, document, void 0);
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filter);
        return createDerivativeSelectorWithFilter(args);
    };
    obj.filterVisible = () => {
        const apiFn = prepare_api_args_1.default('filterVisible');
        const builder = new SelectorBuilder(getSelector(), { filterVisible: true, apiFn }, { instantiation: 'Selector' });
        return builder.getFunction();
    };
    obj.filterHidden = () => {
        const apiFn = prepare_api_args_1.default('filterHidden');
        const builder = new SelectorBuilder(getSelector(), { filterHidden: true, apiFn }, { instantiation: 'Selector' });
        return builder.getFunction();
    };
}
function addCustomDOMPropertiesMethod({ obj, getSelector, SelectorBuilder }) {
    obj.addCustomDOMProperties = customDOMProperties => {
        assertAddCustomDOMPropertiesOptions(customDOMProperties);
        const builder = new SelectorBuilder(getSelector(), { customDOMProperties }, { instantiation: 'Selector' });
        return builder.getFunction();
    };
}
function addCustomMethodsMethod({ obj, getSelector, SelectorBuilder }) {
    obj.addCustomMethods = function (methods, opts) {
        assertAddCustomMethods(methods, opts);
        const customMethods = {};
        Object.keys(methods).forEach(methodName => {
            customMethods[methodName] = {
                method: methods[methodName],
                returnDOMNodes: opts && !!opts.returnDOMNodes
            };
        });
        const builder = new SelectorBuilder(getSelector(), { customMethods }, { instantiation: 'Selector' });
        return builder.getFunction();
    };
}
function addHierarchicalSelectors(options) {
    const { obj } = options;
    // Find
    obj.find = (filter, dependencies) => {
        type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.function], 'find', '"filter" argument', filter);
        const apiFn = prepare_api_args_1.default('find', filter);
        filter = convertFilterToClientFunctionIfNecessary('find', filter, dependencies);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            return expandSelectorResults(selector, node => {
                if (typeof filter === 'string') {
                    return typeof node.querySelectorAll === 'function' ?
                        node.querySelectorAll(filter) :
                        null;
                }
                const results = [];
                const visitNode = currentNode => {
                    const cnLength = currentNode.childNodes.length;
                    for (let i = 0; i < cnLength; i++) {
                        const child = currentNode.childNodes[i];
                        results.push(child);
                        visitNode(child);
                    }
                };
                visitNode(node);
                return filterNodes(results, filter, null, node);
            });
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filter, { expandSelectorResults });
        return createDerivativeSelectorWithFilter(args);
    };
    // Parent
    obj.parent = (filter, dependencies) => {
        if (filter !== void 0)
            type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.function, type_assertions_1.is.number], 'parent', '"filter" argument', filter);
        const apiFn = prepare_api_args_1.default('parent', filter);
        filter = convertFilterToClientFunctionIfNecessary('find', filter, dependencies);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            return expandSelectorResults(selector, node => {
                const parents = [];
                for (let parent = node.parentNode; parent; parent = parent.parentNode)
                    parents.push(parent);
                return filter !== void 0 ? filterNodes(parents, filter, document, node) : parents;
            });
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filter, { expandSelectorResults });
        return createDerivativeSelectorWithFilter(args);
    };
    // Child
    obj.child = (filter, dependencies) => {
        if (filter !== void 0)
            type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.function, type_assertions_1.is.number], 'child', '"filter" argument', filter);
        const apiFn = prepare_api_args_1.default('child', filter);
        filter = convertFilterToClientFunctionIfNecessary('find', filter, dependencies);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            return expandSelectorResults(selector, node => {
                const childElements = [];
                const cnLength = node.childNodes.length;
                for (let i = 0; i < cnLength; i++) {
                    const child = node.childNodes[i];
                    if (child.nodeType === 1)
                        childElements.push(child);
                }
                return filter !== void 0 ? filterNodes(childElements, filter, node, node) : childElements;
            });
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filter, { expandSelectorResults });
        return createDerivativeSelectorWithFilter(args);
    };
    // Sibling
    obj.sibling = (filter, dependencies) => {
        if (filter !== void 0)
            type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.function, type_assertions_1.is.number], 'sibling', '"filter" argument', filter);
        const apiFn = prepare_api_args_1.default('sibling', filter);
        filter = convertFilterToClientFunctionIfNecessary('find', filter, dependencies);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            return expandSelectorResults(selector, node => {
                const parent = node.parentNode;
                if (!parent)
                    return null;
                const siblings = [];
                const cnLength = parent.childNodes.length;
                for (let i = 0; i < cnLength; i++) {
                    const child = parent.childNodes[i];
                    if (child.nodeType === 1 && child !== node)
                        siblings.push(child);
                }
                return filter !== void 0 ? filterNodes(siblings, filter, parent, node) : siblings;
            });
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filter, { expandSelectorResults });
        return createDerivativeSelectorWithFilter(args);
    };
    // Next sibling
    obj.nextSibling = (filter, dependencies) => {
        if (filter !== void 0)
            type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.function, type_assertions_1.is.number], 'nextSibling', '"filter" argument', filter);
        const apiFn = prepare_api_args_1.default('nextSibling', filter);
        filter = convertFilterToClientFunctionIfNecessary('find', filter, dependencies);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            return expandSelectorResults(selector, node => {
                const parent = node.parentNode;
                if (!parent)
                    return null;
                const siblings = [];
                const cnLength = parent.childNodes.length;
                let afterNode = false;
                for (let i = 0; i < cnLength; i++) {
                    const child = parent.childNodes[i];
                    if (child === node)
                        afterNode = true;
                    else if (afterNode && child.nodeType === 1)
                        siblings.push(child);
                }
                return filter !== void 0 ? filterNodes(siblings, filter, parent, node) : siblings;
            });
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filter, { expandSelectorResults });
        return createDerivativeSelectorWithFilter(args);
    };
    // Prev sibling
    obj.prevSibling = (filter, dependencies) => {
        if (filter !== void 0)
            type_assertions_1.assertType([type_assertions_1.is.string, type_assertions_1.is.function, type_assertions_1.is.number], 'prevSibling', '"filter" argument', filter);
        const apiFn = prepare_api_args_1.default('prevSibling', filter);
        filter = convertFilterToClientFunctionIfNecessary('find', filter, dependencies);
        const selectorFn = () => {
            /* eslint-disable no-undef */
            return expandSelectorResults(selector, node => {
                const parent = node.parentNode;
                if (!parent)
                    return null;
                const siblings = [];
                const cnLength = parent.childNodes.length;
                for (let i = 0; i < cnLength; i++) {
                    const child = parent.childNodes[i];
                    if (child === node)
                        break;
                    if (child.nodeType === 1)
                        siblings.push(child);
                }
                return filter !== void 0 ? filterNodes(siblings, filter, parent, node) : siblings;
            });
            /* eslint-enable no-undef */
        };
        const args = getDerivativeSelectorArgs(options, selectorFn, apiFn, filter, { expandSelectorResults });
        return createDerivativeSelectorWithFilter(args);
    };
}
function addAPI(selector, getSelector, SelectorBuilder, customDOMProperties, customMethods, observedCallsites) {
    const options = { obj: selector, getSelector, SelectorBuilder, customDOMProperties, customMethods, observedCallsites };
    addFilterMethods(options);
    addHierarchicalSelectors(options);
    addSnapshotPropertyShorthands(options);
    addCustomDOMPropertiesMethod(options);
    addCustomMethodsMethod(options);
    addCounterProperties(options);
    addVisibleProperty(options);
}
exports.addAPI = addAPI;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWRkLWFwaS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jbGllbnQtZnVuY3Rpb25zL3NlbGVjdG9ycy9hZGQtYXBpLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLCtCQUErQjtBQUMvQixtQ0FBZ0Q7QUFDaEQsdUVBQTREO0FBQzVELCtEQUE0RDtBQUM1RCw0REFBaUU7QUFDakUseUZBQStEO0FBQy9ELDhGQUFvRTtBQUNwRSwwRUFBc0U7QUFDdEUsNEVBQWtEO0FBQ2xELGtGQUF3RDtBQUN4RCw0RkFBa0U7QUFDbEUsMEVBQWtEO0FBRWxELE1BQU0saUJBQWlCLEdBQVMsU0FBUyxDQUFDO0FBQzFDLE1BQU0sdUJBQXVCLEdBQUcsV0FBVywrQkFBbUIsQ0FBQyxJQUFJLEdBQUcsQ0FBQztBQUV2RSxNQUFNLFdBQVcsR0FBRyxDQUFDLElBQUksaUNBQXFCLENBQUMsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLGlCQUFpQixFQUFFLFVBQVUsRUFBRSxHQUFHLFVBQVUsRUFBRSxFQUFFO0lBQzNHLElBQUksT0FBTyxNQUFNLEtBQUssUUFBUSxFQUFFO1FBQzVCLE1BQU0sWUFBWSxHQUFHLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFL0UsT0FBTyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztLQUM3QztJQUVELE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUVsQixJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsRUFBRTtRQUM1QixnRUFBZ0U7UUFDaEUsSUFBSSxpQkFBaUIsQ0FBQyxRQUFRLEtBQUssQ0FBQyxJQUFJLGlCQUFpQixDQUFDLFFBQVEsS0FBSyxDQUFDO1lBQ3BFLE9BQU8sSUFBSSxDQUFDO1FBRWhCLE1BQU0sUUFBUSxHQUFNLGlCQUFpQixDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQy9ELE1BQU0sV0FBVyxHQUFHLEVBQUUsQ0FBQztRQUV2QixLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsUUFBUSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUU7WUFDcEMsV0FBVyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVsQyxNQUFNLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0tBQ25EO0lBRUQsSUFBSSxPQUFPLE1BQU0sS0FBSyxVQUFVLEVBQUU7UUFDOUIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7WUFDbkMsSUFBSSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxVQUFVLEVBQUUsR0FBRyxVQUFVLENBQUM7Z0JBQzlDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7U0FDN0I7S0FDSjtJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2xCLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7QUFFbEIsTUFBTSxxQkFBcUIsR0FBRyxDQUFDLElBQUksaUNBQXFCLENBQUMsQ0FBQyxRQUFRLEVBQUUsdUJBQXVCLEVBQUUsRUFBRTtJQUMzRixNQUFNLEtBQUssR0FBRyxRQUFRLEVBQUUsQ0FBQztJQUV6QixJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU07UUFDYixPQUFPLElBQUksQ0FBQztJQUVoQixNQUFNLE1BQU0sR0FBRyxFQUFFLENBQUM7SUFFbEIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7UUFDbkMsTUFBTSxlQUFlLEdBQUcsdUJBQXVCLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFMUQsSUFBSSxlQUFlLEVBQUU7WUFDakIsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLGVBQWUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7Z0JBQzdDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDO29CQUN0QyxNQUFNLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2FBQ3ZDO1NBQ0o7S0FDSjtJQUVELE9BQU8sTUFBTSxDQUFDO0FBRWxCLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7QUFFbEIsS0FBSyxVQUFVLFdBQVcsQ0FBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxtQkFBbUI7SUFDbkYsSUFBSSxJQUFJLEdBQVMsSUFBSSxDQUFDO0lBQ3RCLE1BQU0sUUFBUSxHQUFHLElBQUksZUFBZSxDQUFDLFdBQVcsRUFBRSxFQUFFLEVBQUUsbUJBQW1CLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxFQUFFLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUMsV0FBVyxFQUFFLENBQUM7SUFFM0ksSUFBSTtRQUNBLElBQUksR0FBRyxNQUFNLFFBQVEsRUFBRSxDQUFDO0tBQzNCO0lBRUQsT0FBTyxHQUFHLEVBQUU7UUFDUixHQUFHLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztRQUN4QixNQUFNLEdBQUcsQ0FBQztLQUNiO0lBRUQsT0FBTyxJQUFJLENBQUM7QUFDaEIsQ0FBQztBQUVELFNBQVMsbUNBQW1DLENBQUUsVUFBVTtJQUNwRCw0QkFBVSxDQUFDLG9CQUFFLENBQUMsYUFBYSxFQUFFLHdCQUF3QixFQUFFLGlDQUFpQyxFQUFFLFVBQVUsQ0FBQyxDQUFDO0lBRXRHLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ25DLDRCQUFVLENBQUMsb0JBQUUsQ0FBQyxRQUFRLEVBQUUsd0JBQXdCLEVBQUUsaUNBQWlDLElBQUksR0FBRyxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ2xILENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELFNBQVMsc0JBQXNCLENBQUUsVUFBVSxFQUFFLElBQUk7SUFDN0MsNEJBQVUsQ0FBQyxvQkFBRSxDQUFDLGFBQWEsRUFBRSxrQkFBa0IsRUFBRSwyQkFBMkIsRUFBRSxVQUFVLENBQUMsQ0FBQztJQUUxRixJQUFJLElBQUksS0FBSyxLQUFLLENBQUM7UUFDZiw0QkFBVSxDQUFDLG9CQUFFLENBQUMsYUFBYSxFQUFFLGtCQUFrQixFQUFFLDJCQUEyQixFQUFFLElBQUksQ0FBQyxDQUFDO0lBRXhGLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ25DLDRCQUFVLENBQUMsb0JBQUUsQ0FBQyxRQUFRLEVBQUUsa0JBQWtCLEVBQUUsa0JBQWtCLElBQUksR0FBRyxFQUFFLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQzdGLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELFNBQVMseUJBQXlCLENBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLHNCQUFzQjtJQUMxRixPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxFQUFFLE9BQU8sRUFBRSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLHNCQUFzQixFQUFFLENBQUMsQ0FBQztBQUM3RixDQUFDO0FBRUQsU0FBUyw0QkFBNEIsQ0FBRSxpQkFBaUIsRUFBRSxRQUFRO0lBQzlELE9BQU8sR0FBRyxFQUFFO1FBQ1IsSUFBSSxpQkFBaUI7WUFDakIsaUJBQWlCLENBQUMsMEJBQTBCLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRS9ELE9BQU8sdUJBQXVCLENBQUM7SUFDbkMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMscUJBQXFCLENBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLGlCQUFpQjtJQUM1RixVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxFQUFFO1FBQ3RCLE1BQU0sQ0FBQyxjQUFjLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRTtZQUM3QixHQUFHLEVBQUUsR0FBRyxFQUFFO2dCQUNOLE1BQU0sUUFBUSxHQUFHLG1DQUFvQixDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUU3QyxNQUFNLGVBQWUsR0FBRywrQkFBbUIsQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUU7b0JBQzFELE1BQU0sUUFBUSxHQUFHLE1BQU0sV0FBVyxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsZUFBZSxDQUFDLENBQUM7b0JBRTNFLE9BQU8sUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUMxQixDQUFDLENBQUMsQ0FBQztnQkFFSCxNQUFNLHNCQUFzQixHQUFHLDRCQUE0QixDQUFDLGlCQUFpQixFQUFFLFFBQVEsQ0FBQyxDQUFDO2dCQUV6RixlQUFlLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxHQUFHLHNCQUFzQixDQUFDO2dCQUM3RCxlQUFlLENBQUMsY0FBTyxDQUFDLE1BQU0sQ0FBQyxHQUFPLHNCQUFzQixDQUFDO2dCQUU3RCxlQUFlLENBQUMsSUFBSSxHQUFHLFVBQVUsV0FBVyxFQUFFLFVBQVU7b0JBQ3BELElBQUksaUJBQWlCLEVBQUU7d0JBQ25CLGlCQUFpQixDQUFDLHlCQUF5QixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQzt3QkFDMUQsaUJBQWlCLENBQUMsMEJBQTBCLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDO3FCQUNqRTtvQkFFRCxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztvQkFFeEIsT0FBTyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsVUFBVSxDQUFDLENBQUM7Z0JBQzNELENBQUMsQ0FBQztnQkFFRixPQUFPLGVBQWUsQ0FBQztZQUMzQixDQUFDO1NBQ0osQ0FBQyxDQUFDO0lBQ1AsQ0FBQyxDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsU0FBUyxrQkFBa0IsQ0FBRSxFQUFFLEdBQUcsRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFO0lBQzlELE1BQU0sQ0FBQyxjQUFjLENBQUMsR0FBRyxFQUFFLGlCQUFpQixFQUFFO1FBQzFDLEdBQUcsRUFBRSxHQUFHLEVBQUU7WUFDTixNQUFNLFFBQVEsR0FBRyxtQ0FBb0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUU3QyxPQUFPLCtCQUFtQixDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRTtnQkFDekMsTUFBTSxRQUFRLEdBQUcsTUFBTSxXQUFXLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsSUFBSSxDQUFDLENBQUM7Z0JBRWpGLE9BQU8sQ0FBQyxDQUFDLFFBQVEsSUFBSSxRQUFRLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUNyRCxDQUFDLENBQUMsQ0FBQztRQUNQLENBQUM7S0FDSixDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsU0FBZ0IsZ0JBQWdCLENBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsYUFBYTtJQUM5RSxNQUFNLGlCQUFpQixHQUFHLGFBQWEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO0lBRTFFLGlCQUFpQixDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRTtRQUM3QixNQUFNLEVBQUUsY0FBYyxHQUFHLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFL0QsTUFBTSxZQUFZLEdBQUc7WUFDakIsWUFBWSxFQUFFLE1BQU07WUFDcEIsUUFBUSxFQUFNLFdBQVcsRUFBRTtTQUM5QixDQUFDO1FBRUYsTUFBTSxhQUFhLEdBQUcsRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLENBQUM7UUFFOUMsSUFBSSxjQUFjLEVBQUU7WUFDaEIsR0FBRyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsRUFBRTtnQkFDcEIsTUFBTSxVQUFVLEdBQUcsR0FBRyxFQUFFO29CQUNwQiw2QkFBNkI7b0JBQzdCLE1BQU0sS0FBSyxHQUFHLFFBQVEsRUFBRSxDQUFDO29CQUV6QixPQUFPLFlBQVksQ0FBQyxLQUFLLENBQUMsWUFBWSxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7b0JBQzlELDRCQUE0QjtnQkFDaEMsQ0FBQyxDQUFDO2dCQUVGLE1BQU0sS0FBSyxHQUFHLDBCQUFnQixDQUFDLElBQUksRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDO2dCQUM5QyxNQUFNLE1BQU0sR0FBRyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUM7Z0JBRTFCLE1BQU0sc0JBQXNCLEdBQUc7b0JBQzNCLElBQUk7b0JBQ0osWUFBWSxFQUFFLE1BQU07aUJBQ3ZCLENBQUM7Z0JBRUYsT0FBTyxrQ0FBa0MsQ0FBQyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsc0JBQXNCLEVBQUUsQ0FBQyxDQUFDO1lBQ25JLENBQUMsQ0FBQztTQUNMO2FBQ0k7WUFDRCxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLGlDQUFxQixDQUFDLENBQUMsR0FBRyxJQUFJLEVBQUUsRUFBRTtnQkFDL0MsNkJBQTZCO2dCQUM3QixNQUFNLElBQUksR0FBRyxRQUFRLEVBQUUsQ0FBQztnQkFFeEIsT0FBTyxZQUFZLENBQUMsS0FBSyxDQUFDLFlBQVksRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO2dCQUM3RCw0QkFBNEI7WUFDaEMsQ0FBQyxFQUFFLEVBQUUsWUFBWSxFQUFFLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQztTQUN0RDtJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQTVDRCw0Q0E0Q0M7QUFFRCxTQUFTLDJCQUEyQixDQUFFLG1CQUFtQjtJQUNyRCxJQUFJLFVBQVUsR0FBRyxDQUFDLEdBQUcseUNBQW1CLENBQUMsQ0FBQztJQUUxQyxnRUFBZ0U7SUFDaEUsYUFBTSxDQUFDLFVBQVUsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0lBRXRDLElBQUksbUJBQW1CO1FBQ25CLFVBQVUsR0FBRyxVQUFVLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDO0lBRXJFLE9BQU8sVUFBVSxDQUFDO0FBQ3RCLENBQUM7QUFFRCxTQUFTLDZCQUE2QixDQUFFLEVBQUUsR0FBRyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsbUJBQW1CLEVBQUUsYUFBYSxFQUFFLGlCQUFpQixFQUFFO0lBQ2hJLE1BQU0sVUFBVSxHQUFHLDJCQUEyQixDQUFDLG1CQUFtQixDQUFDLENBQUM7SUFFcEUscUJBQXFCLENBQUMsR0FBRyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsVUFBVSxFQUFFLGlCQUFpQixDQUFDLENBQUM7SUFDeEYsZ0JBQWdCLENBQUMsR0FBRyxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFFbkUsR0FBRyxDQUFDLGdCQUFnQixHQUFHLElBQUksQ0FBQyxFQUFFO1FBQzFCLE1BQU0sUUFBUSxHQUFHLG1DQUFvQixDQUFDLGtCQUFrQixDQUFDLENBQUM7UUFFMUQsT0FBTywrQkFBbUIsQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDekMsTUFBTSxRQUFRLEdBQUcsTUFBTSxXQUFXLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxlQUFlLENBQUMsQ0FBQztZQUUzRSxPQUFPLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzFELENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQyxDQUFDO0lBRUYsR0FBRyxDQUFDLFlBQVksR0FBRyxRQUFRLENBQUMsRUFBRTtRQUMxQixNQUFNLFFBQVEsR0FBRyxtQ0FBb0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUV0RCxPQUFPLCtCQUFtQixDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRTtZQUN6QyxNQUFNLFFBQVEsR0FBRyxNQUFNLFdBQVcsQ0FBQyxXQUFXLEVBQUUsUUFBUSxFQUFFLGVBQWUsQ0FBQyxDQUFDO1lBRTNFLE9BQU8sUUFBUSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLFVBQVUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDeEUsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUM7SUFFRixHQUFHLENBQUMsWUFBWSxHQUFHLFFBQVEsQ0FBQyxFQUFFO1FBQzFCLE1BQU0sUUFBUSxHQUFHLG1DQUFvQixDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXRELE9BQU8sK0JBQW1CLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQ3pDLE1BQU0sUUFBUSxHQUFHLE1BQU0sV0FBVyxDQUFDLFdBQVcsRUFBRSxRQUFRLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFFM0UsT0FBTyxRQUFRLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFDLGNBQWMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDO1FBQ3RGLENBQUMsQ0FBQyxDQUFDO0lBQ1AsQ0FBQyxDQUFDO0lBRUYsR0FBRyxDQUFDLDZCQUE2QixHQUFHLElBQUksQ0FBQyxFQUFFO1FBQ3ZDLE1BQU0sUUFBUSxHQUFHLG1DQUFvQixDQUFDLCtCQUErQixDQUFDLENBQUM7UUFFdkUsT0FBTywrQkFBbUIsQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDekMsTUFBTSxRQUFRLEdBQUcsTUFBTSxXQUFXLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxlQUFlLENBQUMsQ0FBQztZQUUzRSxPQUFPLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNwRixDQUFDLENBQUMsQ0FBQztJQUNQLENBQUMsQ0FBQztJQUVGLEdBQUcsQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLEVBQUU7UUFDbEIsTUFBTSxRQUFRLEdBQUcsbUNBQW9CLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFbEQsT0FBTywrQkFBbUIsQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDekMsTUFBTSxRQUFRLEdBQUcsTUFBTSxXQUFXLENBQUMsV0FBVyxFQUFFLFFBQVEsRUFBRSxlQUFlLENBQUMsQ0FBQztZQUUzRSxPQUFPLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUM7UUFDaEYsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyxhQUFhLENBQUUsV0FBVyxFQUFFLGVBQWU7SUFDaEQsTUFBTSxPQUFPLEdBQUksSUFBSSxlQUFlLENBQUMsV0FBVyxFQUFFLEVBQUUsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztJQUMxRyxNQUFNLE9BQU8sR0FBSSxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDdkMsTUFBTSxRQUFRLEdBQUcsbUNBQW9CLENBQUMsS0FBSyxDQUFDLENBQUM7SUFFN0MsT0FBTyxLQUFLLElBQUksRUFBRTtRQUNkLElBQUk7WUFDQSxPQUFPLE1BQU0sT0FBTyxFQUFFLENBQUM7U0FDMUI7UUFFRCxPQUFPLEdBQUcsRUFBRTtZQUNSLEdBQUcsQ0FBQyxRQUFRLEdBQUcsUUFBUSxDQUFDO1lBQ3hCLE1BQU0sR0FBRyxDQUFDO1NBQ2I7SUFDTCxDQUFDLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyxvQkFBb0IsQ0FBRSxFQUFFLEdBQUcsRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFO0lBQ2hFLE1BQU0sQ0FBQyxjQUFjLENBQUMsR0FBRyxFQUFFLE9BQU8sRUFBRTtRQUNoQyxHQUFHLEVBQUUsR0FBRyxFQUFFO1lBQ04sTUFBTSxPQUFPLEdBQUcsYUFBYSxDQUFDLFdBQVcsRUFBRSxlQUFlLENBQUMsQ0FBQztZQUU1RCxPQUFPLCtCQUFtQixDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZELENBQUM7S0FDSixDQUFDLENBQUM7SUFFSCxNQUFNLENBQUMsY0FBYyxDQUFDLEdBQUcsRUFBRSxRQUFRLEVBQUU7UUFDakMsR0FBRyxFQUFFLEdBQUcsRUFBRTtZQUNOLE1BQU0sT0FBTyxHQUFHLGFBQWEsQ0FBQyxXQUFXLEVBQUUsZUFBZSxDQUFDLENBQUM7WUFFNUQsT0FBTywrQkFBbUIsQ0FBQyxNQUFNLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQyxNQUFNLE9BQU8sRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7S0FDSixDQUFDLENBQUM7QUFDUCxDQUFDO0FBRUQsU0FBUyx3Q0FBd0MsQ0FBRSxZQUFZLEVBQUUsTUFBTSxFQUFFLFlBQVk7SUFDakYsSUFBSSxPQUFPLE1BQU0sS0FBSyxVQUFVLEVBQUU7UUFDOUIsTUFBTSxPQUFPLEdBQUcsTUFBTSxDQUFDLHdCQUEyQixDQUFDLENBQUM7UUFDcEQsTUFBTSxFQUFFLEdBQVEsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDOUMsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxlQUFNLENBQUMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxPQUFPLEVBQUUsRUFBRSxZQUFZLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLFlBQVksRUFBRSxDQUFDO1FBRTNGLE9BQU8sQ0FBQyxJQUFJLGlDQUFxQixDQUFDLEVBQUUsRUFBRSxPQUFPLEVBQUUsRUFBRSxhQUFhLEVBQUUsWUFBWSxFQUFFLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDO0tBQ2xHO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDbEIsQ0FBQztBQUVELFNBQVMsa0NBQWtDLENBQUUsRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLHNCQUFzQixFQUFFO0lBQzVILE1BQU0sNkJBQTZCLEdBQUcsSUFBSSxlQUFlLENBQUMsV0FBVyxFQUFFLEVBQUUsRUFBRSxjQUFjLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUNuRyxNQUFNLG1CQUFtQixHQUFhLDZCQUE2QixDQUFDLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQztJQUNoRyxNQUFNLGFBQWEsR0FBbUIsNkJBQTZCLENBQUMsT0FBTyxDQUFDLGFBQWEsQ0FBQztJQUUxRixJQUFJLFlBQVksR0FBRztRQUNmLFFBQVEsRUFBSyw2QkFBNkIsQ0FBQyxXQUFXLEVBQUU7UUFDeEQsTUFBTSxFQUFPLE1BQU07UUFDbkIsV0FBVyxFQUFFLFdBQVc7S0FDM0IsQ0FBQztJQUVGLE1BQU0sRUFBRSxZQUFZLEVBQUUsT0FBTyxFQUFFLGVBQWUsRUFBRSxVQUFVLEVBQUUsR0FBRyw2QkFBNkIsQ0FBQyxPQUFPLENBQUM7SUFFckcsWUFBWSxHQUFHLGVBQU0sQ0FBQyxZQUFZLEVBQUUsc0JBQXNCLENBQUMsQ0FBQztJQUU1RCxNQUFNLE9BQU8sR0FBRyxJQUFJLGVBQWUsQ0FBQyxVQUFVLEVBQUU7UUFDNUMsWUFBWTtRQUNaLG1CQUFtQjtRQUNuQixhQUFhO1FBQ2IsWUFBWTtRQUNaLE9BQU87UUFDUCxlQUFlO1FBQ2YsVUFBVTtRQUNWLEtBQUs7S0FDUixFQUFFLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7SUFFbEMsT0FBTyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7QUFDakMsQ0FBQztBQUVELE1BQU0sWUFBWSxHQUFHLHdDQUF3QyxDQUFDLFFBQVEsRUFBRSw4QkFBa0IsQ0FBQyxDQUFDO0FBQzVGLE1BQU0sWUFBWSxHQUFHLHdDQUF3QyxDQUFDLFFBQVEsRUFBRSxtQ0FBdUIsQ0FBQyxDQUFDO0FBRWpHLFNBQVMsbUJBQW1CLENBQUUsR0FBRztJQUM3Qiw4RUFBOEU7SUFDOUUscUZBQXFGO0lBQ3JGLElBQUksT0FBTyxHQUFHLEtBQUssUUFBUSxJQUFJLENBQUMsQ0FBQyxHQUFHLFlBQVksTUFBTSxDQUFDO1FBQ25ELE9BQU8sSUFBSSxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUM7SUFFM0IsT0FBTyxHQUFHLENBQUM7QUFDZixDQUFDO0FBRUQsU0FBUyxnQkFBZ0IsQ0FBRSxPQUFPO0lBQzlCLE1BQU0sRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFFLGVBQWUsRUFBRSxHQUFHLE9BQU8sQ0FBQztJQUV0RCxHQUFHLENBQUMsR0FBRyxHQUFHLEtBQUssQ0FBQyxFQUFFO1FBQ2QsNEJBQVUsQ0FBQyxvQkFBRSxDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsa0JBQWtCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEQsTUFBTSxLQUFLLEdBQUssMEJBQWdCLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQy9DLE1BQU0sT0FBTyxHQUFHLElBQUksZUFBZSxDQUFDLFdBQVcsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFFcEcsT0FBTyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDakMsQ0FBQyxDQUFDO0lBRUYsR0FBRyxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsRUFBRTtRQUNsQiw0QkFBVSxDQUFDLENBQUMsb0JBQUUsQ0FBQyxNQUFNLEVBQUUsb0JBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSxVQUFVLEVBQUUsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFeEUsTUFBTSxLQUFLLEdBQUcsMEJBQWdCLENBQUMsVUFBVSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRWpELElBQUksR0FBRyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUVqQyxNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUU7WUFDcEIsNkJBQTZCO1lBQzdCLE1BQU0sS0FBSyxHQUFHLFFBQVEsRUFBRSxDQUFDO1lBRXpCLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTTtnQkFDYixPQUFPLElBQUksQ0FBQztZQUVoQixPQUFPLFdBQVcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQztZQUM1RCw0QkFBNEI7UUFDaEMsQ0FBQyxDQUFDO1FBRUYsTUFBTSxJQUFJLEdBQUcseUJBQXlCLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLEVBQUUsTUFBTSxFQUFFLHNCQUFVLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBRS9HLE9BQU8sa0NBQWtDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDcEQsQ0FBQyxDQUFDO0lBRUYsR0FBRyxDQUFDLGFBQWEsR0FBRyxJQUFJLENBQUMsRUFBRTtRQUN2Qiw0QkFBVSxDQUFDLG9CQUFFLENBQUMsTUFBTSxFQUFFLGVBQWUsRUFBRSxpQkFBaUIsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVoRSxNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUU7WUFDcEIsNkJBQTZCO1lBQzdCLE1BQU0sS0FBSyxHQUFHLFFBQVEsRUFBRSxDQUFDO1lBRXpCLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTTtnQkFDYixPQUFPLElBQUksQ0FBQztZQUVoQixPQUFPLFdBQVcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxLQUFLLENBQUMsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUMvRCw0QkFBNEI7UUFDaEMsQ0FBQyxDQUFDO1FBRUYsTUFBTSxLQUFLLEdBQUcsMEJBQWdCLENBQUMsZUFBZSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQ3RELE1BQU0sSUFBSSxHQUFJLHlCQUF5QixDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRXZHLE9BQU8sa0NBQWtDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDcEQsQ0FBQyxDQUFDO0lBRUYsR0FBRyxDQUFDLGFBQWEsR0FBRyxDQUFDLFFBQVEsRUFBRSxTQUFTLEVBQUUsRUFBRTtRQUN4Qyw0QkFBVSxDQUFDLENBQUMsb0JBQUUsQ0FBQyxNQUFNLEVBQUUsb0JBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSxlQUFlLEVBQUUscUJBQXFCLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFckYsTUFBTSxLQUFLLEdBQUcsMEJBQWdCLENBQUMsZUFBZSxFQUFFLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUVyRSxRQUFRLEdBQUcsbUJBQW1CLENBQUMsUUFBUSxDQUFDLENBQUM7UUFFekMsSUFBSSxTQUFTLEtBQUssS0FBSyxDQUFDLEVBQUU7WUFDdEIsNEJBQVUsQ0FBQyxDQUFDLG9CQUFFLENBQUMsTUFBTSxFQUFFLG9CQUFFLENBQUMsTUFBTSxDQUFDLEVBQUUsZUFBZSxFQUFFLHNCQUFzQixFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQ3ZGLFNBQVMsR0FBRyxtQkFBbUIsQ0FBQyxTQUFTLENBQUMsQ0FBQztTQUM5QztRQUVELE1BQU0sVUFBVSxHQUFHLEdBQUcsRUFBRTtZQUNwQiw2QkFBNkI7WUFDN0IsTUFBTSxLQUFLLEdBQUcsUUFBUSxFQUFFLENBQUM7WUFFekIsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNO2dCQUNiLE9BQU8sSUFBSSxDQUFDO1lBRWhCLE9BQU8sV0FBVyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLEtBQUssQ0FBQyxFQUFFLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBQztZQUN6RSw0QkFBNEI7UUFDaEMsQ0FBQyxDQUFDO1FBRUYsTUFBTSxJQUFJLEdBQUcseUJBQXlCLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFO1lBQzdFLFFBQVE7WUFDUixTQUFTO1NBQ1osQ0FBQyxDQUFDO1FBRUgsT0FBTyxrQ0FBa0MsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNwRCxDQUFDLENBQUM7SUFFRixHQUFHLENBQUMsTUFBTSxHQUFHLENBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFO1FBQ2xDLDRCQUFVLENBQUMsQ0FBQyxvQkFBRSxDQUFDLE1BQU0sRUFBRSxvQkFBRSxDQUFDLFFBQVEsQ0FBQyxFQUFFLFFBQVEsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUU1RSxNQUFNLEtBQUssR0FBRywwQkFBZ0IsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFakQsTUFBTSxHQUFHLHdDQUF3QyxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFFbEYsTUFBTSxVQUFVLEdBQUcsR0FBRyxFQUFFO1lBQ3BCLDZCQUE2QjtZQUM3QixNQUFNLEtBQUssR0FBRyxRQUFRLEVBQUUsQ0FBQztZQUV6QixJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU07Z0JBQ2IsT0FBTyxJQUFJLENBQUM7WUFFaEIsT0FBTyxXQUFXLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUNwRCw0QkFBNEI7UUFDaEMsQ0FBQyxDQUFDO1FBR0YsTUFBTSxJQUFJLEdBQUcseUJBQXlCLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFM0UsT0FBTyxrQ0FBa0MsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNwRCxDQUFDLENBQUM7SUFFRixHQUFHLENBQUMsYUFBYSxHQUFHLEdBQUcsRUFBRTtRQUNyQixNQUFNLEtBQUssR0FBSywwQkFBZ0IsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUNsRCxNQUFNLE9BQU8sR0FBRyxJQUFJLGVBQWUsQ0FBQyxXQUFXLEVBQUUsRUFBRSxFQUFFLGFBQWEsRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUVsSCxPQUFPLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNqQyxDQUFDLENBQUM7SUFFRixHQUFHLENBQUMsWUFBWSxHQUFHLEdBQUcsRUFBRTtRQUNwQixNQUFNLEtBQUssR0FBSywwQkFBZ0IsQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNqRCxNQUFNLE9BQU8sR0FBRyxJQUFJLGVBQWUsQ0FBQyxXQUFXLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUVqSCxPQUFPLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNqQyxDQUFDLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyw0QkFBNEIsQ0FBRSxFQUFFLEdBQUcsRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFO0lBQ3hFLEdBQUcsQ0FBQyxzQkFBc0IsR0FBRyxtQkFBbUIsQ0FBQyxFQUFFO1FBQy9DLG1DQUFtQyxDQUFDLG1CQUFtQixDQUFDLENBQUM7UUFFekQsTUFBTSxPQUFPLEdBQUcsSUFBSSxlQUFlLENBQUMsV0FBVyxFQUFFLEVBQUUsRUFBRSxtQkFBbUIsRUFBRSxFQUFFLEVBQUUsYUFBYSxFQUFFLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFFM0csT0FBTyxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDakMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVELFNBQVMsc0JBQXNCLENBQUUsRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFFLGVBQWUsRUFBRTtJQUNsRSxHQUFHLENBQUMsZ0JBQWdCLEdBQUcsVUFBVSxPQUFPLEVBQUUsSUFBSTtRQUMxQyxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFdEMsTUFBTSxhQUFhLEdBQUcsRUFBRSxDQUFDO1FBRXpCLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFO1lBQ3RDLGFBQWEsQ0FBQyxVQUFVLENBQUMsR0FBRztnQkFDeEIsTUFBTSxFQUFVLE9BQU8sQ0FBQyxVQUFVLENBQUM7Z0JBQ25DLGNBQWMsRUFBRSxJQUFJLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxjQUFjO2FBQ2hELENBQUM7UUFDTixDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxHQUFHLElBQUksZUFBZSxDQUFDLFdBQVcsRUFBRSxFQUFFLEVBQUUsYUFBYSxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUUsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUVyRyxPQUFPLE9BQU8sQ0FBQyxXQUFXLEVBQUUsQ0FBQztJQUNqQyxDQUFDLENBQUM7QUFDTixDQUFDO0FBRUQsU0FBUyx3QkFBd0IsQ0FBRSxPQUFPO0lBQ3RDLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxPQUFPLENBQUM7SUFFeEIsT0FBTztJQUNQLEdBQUcsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUU7UUFDaEMsNEJBQVUsQ0FBQyxDQUFDLG9CQUFFLENBQUMsTUFBTSxFQUFFLG9CQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRTFFLE1BQU0sS0FBSyxHQUFHLDBCQUFnQixDQUFDLE1BQU0sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUUvQyxNQUFNLEdBQUcsd0NBQXdDLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxZQUFZLENBQUMsQ0FBQztRQUVoRixNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUU7WUFDcEIsNkJBQTZCO1lBQzdCLE9BQU8scUJBQXFCLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxFQUFFO2dCQUMxQyxJQUFJLE9BQU8sTUFBTSxLQUFLLFFBQVEsRUFBRTtvQkFDNUIsT0FBTyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsS0FBSyxVQUFVLENBQUMsQ0FBQzt3QkFDaEQsSUFBSSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7d0JBQy9CLElBQUksQ0FBQztpQkFDWjtnQkFFRCxNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUM7Z0JBRW5CLE1BQU0sU0FBUyxHQUFHLFdBQVcsQ0FBQyxFQUFFO29CQUM1QixNQUFNLFFBQVEsR0FBRyxXQUFXLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztvQkFFL0MsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFFBQVEsRUFBRSxDQUFDLEVBQUUsRUFBRTt3QkFDL0IsTUFBTSxLQUFLLEdBQUcsV0FBVyxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQzt3QkFFeEMsT0FBTyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQzt3QkFFcEIsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO3FCQUNwQjtnQkFDTCxDQUFDLENBQUM7Z0JBRUYsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO2dCQUVoQixPQUFPLFdBQVcsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztZQUNwRCxDQUFDLENBQUMsQ0FBQztZQUNILDRCQUE0QjtRQUNoQyxDQUFDLENBQUM7UUFFRixNQUFNLElBQUksR0FBRyx5QkFBeUIsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxDQUFDLENBQUM7UUFFdEcsT0FBTyxrQ0FBa0MsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNwRCxDQUFDLENBQUM7SUFFRixTQUFTO0lBQ1QsR0FBRyxDQUFDLE1BQU0sR0FBRyxDQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRTtRQUNsQyxJQUFJLE1BQU0sS0FBSyxLQUFLLENBQUM7WUFDakIsNEJBQVUsQ0FBQyxDQUFDLG9CQUFFLENBQUMsTUFBTSxFQUFFLG9CQUFFLENBQUMsUUFBUSxFQUFFLG9CQUFFLENBQUMsTUFBTSxDQUFDLEVBQUUsUUFBUSxFQUFFLG1CQUFtQixFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRTNGLE1BQU0sS0FBSyxHQUFHLDBCQUFnQixDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUVqRCxNQUFNLEdBQUcsd0NBQXdDLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxZQUFZLENBQUMsQ0FBQztRQUVoRixNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUU7WUFDcEIsNkJBQTZCO1lBQzdCLE9BQU8scUJBQXFCLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxFQUFFO2dCQUMxQyxNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUM7Z0JBRW5CLEtBQUssSUFBSSxNQUFNLEdBQUcsSUFBSSxDQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUUsTUFBTSxHQUFHLE1BQU0sQ0FBQyxVQUFVO29CQUNqRSxPQUFPLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUV6QixPQUFPLE1BQU0sS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUM7WUFDdEYsQ0FBQyxDQUFDLENBQUM7WUFDSCw0QkFBNEI7UUFDaEMsQ0FBQyxDQUFDO1FBRUYsTUFBTSxJQUFJLEdBQUcseUJBQXlCLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUUscUJBQXFCLEVBQUUsQ0FBQyxDQUFDO1FBRXRHLE9BQU8sa0NBQWtDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDcEQsQ0FBQyxDQUFDO0lBRUYsUUFBUTtJQUNSLEdBQUcsQ0FBQyxLQUFLLEdBQUcsQ0FBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUU7UUFDakMsSUFBSSxNQUFNLEtBQUssS0FBSyxDQUFDO1lBQ2pCLDRCQUFVLENBQUMsQ0FBQyxvQkFBRSxDQUFDLE1BQU0sRUFBRSxvQkFBRSxDQUFDLFFBQVEsRUFBRSxvQkFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFLE9BQU8sRUFBRSxtQkFBbUIsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUUxRixNQUFNLEtBQUssR0FBRywwQkFBZ0IsQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFaEQsTUFBTSxHQUFHLHdDQUF3QyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFFaEYsTUFBTSxVQUFVLEdBQUcsR0FBRyxFQUFFO1lBQ3BCLDZCQUE2QjtZQUM3QixPQUFPLHFCQUFxQixDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsRUFBRTtnQkFDMUMsTUFBTSxhQUFhLEdBQUcsRUFBRSxDQUFDO2dCQUN6QixNQUFNLFFBQVEsR0FBUSxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztnQkFFN0MsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFFBQVEsRUFBRSxDQUFDLEVBQUUsRUFBRTtvQkFDL0IsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFFakMsSUFBSSxLQUFLLENBQUMsUUFBUSxLQUFLLENBQUM7d0JBQ3BCLGFBQWEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7aUJBQ2pDO2dCQUVELE9BQU8sTUFBTSxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUMsYUFBYSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLGFBQWEsQ0FBQztZQUM5RixDQUFDLENBQUMsQ0FBQztZQUNILDRCQUE0QjtRQUNoQyxDQUFDLENBQUM7UUFFRixNQUFNLElBQUksR0FBRyx5QkFBeUIsQ0FBQyxPQUFPLEVBQUUsVUFBVSxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRSxxQkFBcUIsRUFBRSxDQUFDLENBQUM7UUFFdEcsT0FBTyxrQ0FBa0MsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNwRCxDQUFDLENBQUM7SUFFRixVQUFVO0lBQ1YsR0FBRyxDQUFDLE9BQU8sR0FBRyxDQUFDLE1BQU0sRUFBRSxZQUFZLEVBQUUsRUFBRTtRQUNuQyxJQUFJLE1BQU0sS0FBSyxLQUFLLENBQUM7WUFDakIsNEJBQVUsQ0FBQyxDQUFDLG9CQUFFLENBQUMsTUFBTSxFQUFFLG9CQUFFLENBQUMsUUFBUSxFQUFFLG9CQUFFLENBQUMsTUFBTSxDQUFDLEVBQUUsU0FBUyxFQUFFLG1CQUFtQixFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRTVGLE1BQU0sS0FBSyxHQUFHLDBCQUFnQixDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUVsRCxNQUFNLEdBQUcsd0NBQXdDLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxZQUFZLENBQUMsQ0FBQztRQUVoRixNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUU7WUFDcEIsNkJBQTZCO1lBQzdCLE9BQU8scUJBQXFCLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxFQUFFO2dCQUMxQyxNQUFNLE1BQU0sR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDO2dCQUUvQixJQUFJLENBQUMsTUFBTTtvQkFDUCxPQUFPLElBQUksQ0FBQztnQkFFaEIsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFDO2dCQUNwQixNQUFNLFFBQVEsR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQztnQkFFMUMsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFFBQVEsRUFBRSxDQUFDLEVBQUUsRUFBRTtvQkFDL0IsTUFBTSxLQUFLLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFFbkMsSUFBSSxLQUFLLENBQUMsUUFBUSxLQUFLLENBQUMsSUFBSSxLQUFLLEtBQUssSUFBSTt3QkFDdEMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztpQkFDNUI7Z0JBRUQsT0FBTyxNQUFNLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO1lBQ3RGLENBQUMsQ0FBQyxDQUFDO1lBQ0gsNEJBQTRCO1FBQ2hDLENBQUMsQ0FBQztRQUVGLE1BQU0sSUFBSSxHQUFHLHlCQUF5QixDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLHFCQUFxQixFQUFFLENBQUMsQ0FBQztRQUV0RyxPQUFPLGtDQUFrQyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3BELENBQUMsQ0FBQztJQUVGLGVBQWU7SUFDZixHQUFHLENBQUMsV0FBVyxHQUFHLENBQUMsTUFBTSxFQUFFLFlBQVksRUFBRSxFQUFFO1FBQ3ZDLElBQUksTUFBTSxLQUFLLEtBQUssQ0FBQztZQUNqQiw0QkFBVSxDQUFDLENBQUMsb0JBQUUsQ0FBQyxNQUFNLEVBQUUsb0JBQUUsQ0FBQyxRQUFRLEVBQUUsb0JBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSxhQUFhLEVBQUUsbUJBQW1CLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFaEcsTUFBTSxLQUFLLEdBQUcsMEJBQWdCLENBQUMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBRXRELE1BQU0sR0FBRyx3Q0FBd0MsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLFlBQVksQ0FBQyxDQUFDO1FBRWhGLE1BQU0sVUFBVSxHQUFHLEdBQUcsRUFBRTtZQUNwQiw2QkFBNkI7WUFDN0IsT0FBTyxxQkFBcUIsQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLEVBQUU7Z0JBQzFDLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUM7Z0JBRS9CLElBQUksQ0FBQyxNQUFNO29CQUNQLE9BQU8sSUFBSSxDQUFDO2dCQUVoQixNQUFNLFFBQVEsR0FBRyxFQUFFLENBQUM7Z0JBQ3BCLE1BQU0sUUFBUSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDO2dCQUMxQyxJQUFJLFNBQVMsR0FBSSxLQUFLLENBQUM7Z0JBRXZCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxRQUFRLEVBQUUsQ0FBQyxFQUFFLEVBQUU7b0JBQy9CLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBRW5DLElBQUksS0FBSyxLQUFLLElBQUk7d0JBQ2QsU0FBUyxHQUFHLElBQUksQ0FBQzt5QkFFaEIsSUFBSSxTQUFTLElBQUksS0FBSyxDQUFDLFFBQVEsS0FBSyxDQUFDO3dCQUN0QyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO2lCQUM1QjtnQkFFRCxPQUFPLE1BQU0sS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUM7WUFDdEYsQ0FBQyxDQUFDLENBQUM7WUFDSCw0QkFBNEI7UUFDaEMsQ0FBQyxDQUFDO1FBRUYsTUFBTSxJQUFJLEdBQUcseUJBQXlCLENBQUMsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUUscUJBQXFCLEVBQUUsQ0FBQyxDQUFDO1FBRXRHLE9BQU8sa0NBQWtDLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDcEQsQ0FBQyxDQUFDO0lBRUYsZUFBZTtJQUNmLEdBQUcsQ0FBQyxXQUFXLEdBQUcsQ0FBQyxNQUFNLEVBQUUsWUFBWSxFQUFFLEVBQUU7UUFDdkMsSUFBSSxNQUFNLEtBQUssS0FBSyxDQUFDO1lBQ2pCLDRCQUFVLENBQUMsQ0FBQyxvQkFBRSxDQUFDLE1BQU0sRUFBRSxvQkFBRSxDQUFDLFFBQVEsRUFBRSxvQkFBRSxDQUFDLE1BQU0sQ0FBQyxFQUFFLGFBQWEsRUFBRSxtQkFBbUIsRUFBRSxNQUFNLENBQUMsQ0FBQztRQUVoRyxNQUFNLEtBQUssR0FBRywwQkFBZ0IsQ0FBQyxhQUFhLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFFdEQsTUFBTSxHQUFHLHdDQUF3QyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsWUFBWSxDQUFDLENBQUM7UUFFaEYsTUFBTSxVQUFVLEdBQUcsR0FBRyxFQUFFO1lBQ3BCLDZCQUE2QjtZQUM3QixPQUFPLHFCQUFxQixDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsRUFBRTtnQkFDMUMsTUFBTSxNQUFNLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQztnQkFFL0IsSUFBSSxDQUFDLE1BQU07b0JBQ1AsT0FBTyxJQUFJLENBQUM7Z0JBRWhCLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQztnQkFDcEIsTUFBTSxRQUFRLEdBQUcsTUFBTSxDQUFDLFVBQVUsQ0FBQyxNQUFNLENBQUM7Z0JBRTFDLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxRQUFRLEVBQUUsQ0FBQyxFQUFFLEVBQUU7b0JBQy9CLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBRW5DLElBQUksS0FBSyxLQUFLLElBQUk7d0JBQ2QsTUFBTTtvQkFFVixJQUFJLEtBQUssQ0FBQyxRQUFRLEtBQUssQ0FBQzt3QkFDcEIsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztpQkFDNUI7Z0JBRUQsT0FBTyxNQUFNLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxRQUFRLEVBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO1lBQ3RGLENBQUMsQ0FBQyxDQUFDO1lBQ0gsNEJBQTRCO1FBQ2hDLENBQUMsQ0FBQztRQUVGLE1BQU0sSUFBSSxHQUFHLHlCQUF5QixDQUFDLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFLHFCQUFxQixFQUFFLENBQUMsQ0FBQztRQUV0RyxPQUFPLGtDQUFrQyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3BELENBQUMsQ0FBQztBQUNOLENBQUM7QUFFRCxTQUFnQixNQUFNLENBQUUsUUFBUSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsbUJBQW1CLEVBQUUsYUFBYSxFQUFFLGlCQUFpQjtJQUNqSCxNQUFNLE9BQU8sR0FBRyxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLGVBQWUsRUFBRSxtQkFBbUIsRUFBRSxhQUFhLEVBQUUsaUJBQWlCLEVBQUUsQ0FBQztJQUV2SCxnQkFBZ0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUMxQix3QkFBd0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNsQyw2QkFBNkIsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN2Qyw0QkFBNEIsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUN0QyxzQkFBc0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNoQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUM5QixrQkFBa0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztBQUNoQyxDQUFDO0FBVkQsd0JBVUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBpbnNwZWN0IH0gZnJvbSAndXRpbCc7XG5pbXBvcnQgeyBhc3NpZ24sIHB1bGwgYXMgcmVtb3ZlIH0gZnJvbSAnbG9kYXNoJztcbmltcG9ydCBjbGllbnRGdW5jdGlvbkJ1aWxkZXJTeW1ib2wgZnJvbSAnLi4vYnVpbGRlci1zeW1ib2wnO1xuaW1wb3J0IHsgU05BUFNIT1RfUFJPUEVSVElFUyB9IGZyb20gJy4vc25hcHNob3QtcHJvcGVydGllcyc7XG5pbXBvcnQgeyBnZXRDYWxsc2l0ZUZvck1ldGhvZCB9IGZyb20gJy4uLy4uL2Vycm9ycy9nZXQtY2FsbHNpdGUnO1xuaW1wb3J0IENsaWVudEZ1bmN0aW9uQnVpbGRlciBmcm9tICcuLi9jbGllbnQtZnVuY3Rpb24tYnVpbGRlcic7XG5pbXBvcnQgUmVFeGVjdXRhYmxlUHJvbWlzZSBmcm9tICcuLi8uLi91dGlscy9yZS1leGVjdXRhYmxlLXByb21pc2UnO1xuaW1wb3J0IHsgYXNzZXJ0VHlwZSwgaXMgfSBmcm9tICcuLi8uLi9lcnJvcnMvcnVudGltZS90eXBlLWFzc2VydGlvbnMnO1xuaW1wb3J0IG1ha2VSZWdFeHAgZnJvbSAnLi4vLi4vdXRpbHMvbWFrZS1yZWctZXhwJztcbmltcG9ydCBzZWxlY3RvclRleHRGaWx0ZXIgZnJvbSAnLi9zZWxlY3Rvci10ZXh0LWZpbHRlcic7XG5pbXBvcnQgc2VsZWN0b3JBdHRyaWJ1dGVGaWx0ZXIgZnJvbSAnLi9zZWxlY3Rvci1hdHRyaWJ1dGUtZmlsdGVyJztcbmltcG9ydCBwcmVwYXJlQXBpRm5BcmdzIGZyb20gJy4vcHJlcGFyZS1hcGktYXJncyc7XG5cbmNvbnN0IFZJU0lCTEVfUFJPUF9OQU1FICAgICAgID0gJ3Zpc2libGUnO1xuY29uc3QgU05BUFNIT1RfUFJPUF9QUklNSVRJVkUgPSBgW29iamVjdCAke1JlRXhlY3V0YWJsZVByb21pc2UubmFtZX1dYDtcblxuY29uc3QgZmlsdGVyTm9kZXMgPSAobmV3IENsaWVudEZ1bmN0aW9uQnVpbGRlcigobm9kZXMsIGZpbHRlciwgcXVlcnlTZWxlY3RvclJvb3QsIG9yaWdpbk5vZGUsIC4uLmZpbHRlckFyZ3MpID0+IHtcbiAgICBpZiAodHlwZW9mIGZpbHRlciA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgY29uc3QgbWF0Y2hpbmdOb2RlID0gZmlsdGVyIDwgMCA/IG5vZGVzW25vZGVzLmxlbmd0aCArIGZpbHRlcl0gOiBub2Rlc1tmaWx0ZXJdO1xuXG4gICAgICAgIHJldHVybiBtYXRjaGluZ05vZGUgPyBbbWF0Y2hpbmdOb2RlXSA6IFtdO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xuXG4gICAgaWYgKHR5cGVvZiBmaWx0ZXIgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIC8vIE5PVEU6IHdlIGNhbiBzZWFyY2ggZm9yIGVsZW1lbnRzIG9ubHkgaW4gZG9jdW1lbnQgb3IgZWxlbWVudC5cbiAgICAgICAgaWYgKHF1ZXJ5U2VsZWN0b3JSb290Lm5vZGVUeXBlICE9PSAxICYmIHF1ZXJ5U2VsZWN0b3JSb290Lm5vZGVUeXBlICE9PSA5KVxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgY29uc3QgbWF0Y2hpbmcgICAgPSBxdWVyeVNlbGVjdG9yUm9vdC5xdWVyeVNlbGVjdG9yQWxsKGZpbHRlcik7XG4gICAgICAgIGNvbnN0IG1hdGNoaW5nQXJyID0gW107XG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBtYXRjaGluZy5sZW5ndGg7IGkrKylcbiAgICAgICAgICAgIG1hdGNoaW5nQXJyLnB1c2gobWF0Y2hpbmdbaV0pO1xuXG4gICAgICAgIGZpbHRlciA9IG5vZGUgPT4gbWF0Y2hpbmdBcnIuaW5kZXhPZihub2RlKSA+IC0xO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsdGVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgbm9kZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgIGlmIChmaWx0ZXIobm9kZXNbal0sIGosIG9yaWdpbk5vZGUsIC4uLmZpbHRlckFyZ3MpKVxuICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKG5vZGVzW2pdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG59KSkuZ2V0RnVuY3Rpb24oKTtcblxuY29uc3QgZXhwYW5kU2VsZWN0b3JSZXN1bHRzID0gKG5ldyBDbGllbnRGdW5jdGlvbkJ1aWxkZXIoKHNlbGVjdG9yLCBwb3B1bGF0ZURlcml2YXRpdmVOb2RlcykgPT4ge1xuICAgIGNvbnN0IG5vZGVzID0gc2VsZWN0b3IoKTtcblxuICAgIGlmICghbm9kZXMubGVuZ3RoKVxuICAgICAgICByZXR1cm4gbnVsbDtcblxuICAgIGNvbnN0IHJlc3VsdCA9IFtdO1xuXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBub2Rlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBjb25zdCBkZXJpdmF0aXZlTm9kZXMgPSBwb3B1bGF0ZURlcml2YXRpdmVOb2Rlcyhub2Rlc1tpXSk7XG5cbiAgICAgICAgaWYgKGRlcml2YXRpdmVOb2Rlcykge1xuICAgICAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBkZXJpdmF0aXZlTm9kZXMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0LmluZGV4T2YoZGVyaXZhdGl2ZU5vZGVzW2pdKSA8IDApXG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdC5wdXNoKGRlcml2YXRpdmVOb2Rlc1tqXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0O1xuXG59KSkuZ2V0RnVuY3Rpb24oKTtcblxuYXN5bmMgZnVuY3Rpb24gZ2V0U25hcHNob3QgKGdldFNlbGVjdG9yLCBjYWxsc2l0ZSwgU2VsZWN0b3JCdWlsZGVyLCBnZXRWaXNpYmxlVmFsdWVNb2RlKSB7XG4gICAgbGV0IG5vZGUgICAgICAgPSBudWxsO1xuICAgIGNvbnN0IHNlbGVjdG9yID0gbmV3IFNlbGVjdG9yQnVpbGRlcihnZXRTZWxlY3RvcigpLCB7IGdldFZpc2libGVWYWx1ZU1vZGUsIG5lZWRFcnJvcjogdHJ1ZSB9LCB7IGluc3RhbnRpYXRpb246ICdTZWxlY3RvcicgfSkuZ2V0RnVuY3Rpb24oKTtcblxuICAgIHRyeSB7XG4gICAgICAgIG5vZGUgPSBhd2FpdCBzZWxlY3RvcigpO1xuICAgIH1cblxuICAgIGNhdGNoIChlcnIpIHtcbiAgICAgICAgZXJyLmNhbGxzaXRlID0gY2FsbHNpdGU7XG4gICAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICByZXR1cm4gbm9kZTtcbn1cblxuZnVuY3Rpb24gYXNzZXJ0QWRkQ3VzdG9tRE9NUHJvcGVydGllc09wdGlvbnMgKHByb3BlcnRpZXMpIHtcbiAgICBhc3NlcnRUeXBlKGlzLm5vbk51bGxPYmplY3QsICdhZGRDdXN0b21ET01Qcm9wZXJ0aWVzJywgJ1wiYWRkQ3VzdG9tRE9NUHJvcGVydGllc1wiIG9wdGlvbicsIHByb3BlcnRpZXMpO1xuXG4gICAgT2JqZWN0LmtleXMocHJvcGVydGllcykuZm9yRWFjaChwcm9wID0+IHtcbiAgICAgICAgYXNzZXJ0VHlwZShpcy5mdW5jdGlvbiwgJ2FkZEN1c3RvbURPTVByb3BlcnRpZXMnLCBgQ3VzdG9tIERPTSBwcm9wZXJ0aWVzIG1ldGhvZCAnJHtwcm9wfSdgLCBwcm9wZXJ0aWVzW3Byb3BdKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gYXNzZXJ0QWRkQ3VzdG9tTWV0aG9kcyAocHJvcGVydGllcywgb3B0cykge1xuICAgIGFzc2VydFR5cGUoaXMubm9uTnVsbE9iamVjdCwgJ2FkZEN1c3RvbU1ldGhvZHMnLCAnXCJhZGRDdXN0b21NZXRob2RzXCIgb3B0aW9uJywgcHJvcGVydGllcyk7XG5cbiAgICBpZiAob3B0cyAhPT0gdm9pZCAwKVxuICAgICAgICBhc3NlcnRUeXBlKGlzLm5vbk51bGxPYmplY3QsICdhZGRDdXN0b21NZXRob2RzJywgJ1wiYWRkQ3VzdG9tTWV0aG9kc1wiIG9wdGlvbicsIG9wdHMpO1xuXG4gICAgT2JqZWN0LmtleXMocHJvcGVydGllcykuZm9yRWFjaChwcm9wID0+IHtcbiAgICAgICAgYXNzZXJ0VHlwZShpcy5mdW5jdGlvbiwgJ2FkZEN1c3RvbU1ldGhvZHMnLCBgQ3VzdG9tIG1ldGhvZCAnJHtwcm9wfSdgLCBwcm9wZXJ0aWVzW3Byb3BdKTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gZ2V0RGVyaXZhdGl2ZVNlbGVjdG9yQXJncyAob3B0aW9ucywgc2VsZWN0b3JGbiwgYXBpRm4sIGZpbHRlciwgYWRkaXRpb25hbERlcGVuZGVuY2llcykge1xuICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCBvcHRpb25zLCB7IHNlbGVjdG9yRm4sIGFwaUZuLCBmaWx0ZXIsIGFkZGl0aW9uYWxEZXBlbmRlbmNpZXMgfSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZVByaW1pdGl2ZUdldHRlcldyYXBwZXIgKG9ic2VydmVkQ2FsbHNpdGVzLCBjYWxsc2l0ZSkge1xuICAgIHJldHVybiAoKSA9PiB7XG4gICAgICAgIGlmIChvYnNlcnZlZENhbGxzaXRlcylcbiAgICAgICAgICAgIG9ic2VydmVkQ2FsbHNpdGVzLnVuYXdhaXRlZFNuYXBzaG90Q2FsbHNpdGVzLmFkZChjYWxsc2l0ZSk7XG5cbiAgICAgICAgcmV0dXJuIFNOQVBTSE9UX1BST1BfUFJJTUlUSVZFO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGFkZFNuYXBzaG90UHJvcGVydGllcyAob2JqLCBnZXRTZWxlY3RvciwgU2VsZWN0b3JCdWlsZGVyLCBwcm9wZXJ0aWVzLCBvYnNlcnZlZENhbGxzaXRlcykge1xuICAgIHByb3BlcnRpZXMuZm9yRWFjaChwcm9wID0+IHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwgcHJvcCwge1xuICAgICAgICAgICAgZ2V0OiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgY2FsbHNpdGUgPSBnZXRDYWxsc2l0ZUZvck1ldGhvZCgnZ2V0Jyk7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBwcm9wZXJ0eVByb21pc2UgPSBSZUV4ZWN1dGFibGVQcm9taXNlLmZyb21Gbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgZ2V0U25hcHNob3QoZ2V0U2VsZWN0b3IsIGNhbGxzaXRlLCBTZWxlY3RvckJ1aWxkZXIpO1xuXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBzbmFwc2hvdFtwcm9wXTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHByaW1pdGl2ZUdldHRlcldyYXBwZXIgPSBjcmVhdGVQcmltaXRpdmVHZXR0ZXJXcmFwcGVyKG9ic2VydmVkQ2FsbHNpdGVzLCBjYWxsc2l0ZSk7XG5cbiAgICAgICAgICAgICAgICBwcm9wZXJ0eVByb21pc2VbU3ltYm9sLnRvUHJpbWl0aXZlXSA9IHByaW1pdGl2ZUdldHRlcldyYXBwZXI7XG4gICAgICAgICAgICAgICAgcHJvcGVydHlQcm9taXNlW2luc3BlY3QuY3VzdG9tXSAgICAgPSBwcmltaXRpdmVHZXR0ZXJXcmFwcGVyO1xuXG4gICAgICAgICAgICAgICAgcHJvcGVydHlQcm9taXNlLnRoZW4gPSBmdW5jdGlvbiAob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKG9ic2VydmVkQ2FsbHNpdGVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBvYnNlcnZlZENhbGxzaXRlcy5zbmFwc2hvdFByb3BlcnR5Q2FsbHNpdGVzLmFkZChjYWxsc2l0ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBvYnNlcnZlZENhbGxzaXRlcy51bmF3YWl0ZWRTbmFwc2hvdENhbGxzaXRlcy5kZWxldGUoY2FsbHNpdGUpO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZW5zdXJlRXhlY3V0aW5nKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3Rhc2tQcm9taXNlLnRoZW4ob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpO1xuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvcGVydHlQcm9taXNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gYWRkVmlzaWJsZVByb3BlcnR5ICh7IG9iaiwgZ2V0U2VsZWN0b3IsIFNlbGVjdG9yQnVpbGRlciB9KSB7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwgVklTSUJMRV9QUk9QX05BTUUsIHtcbiAgICAgICAgZ2V0OiAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBjYWxsc2l0ZSA9IGdldENhbGxzaXRlRm9yTWV0aG9kKCdnZXQnKTtcblxuICAgICAgICAgICAgcmV0dXJuIFJlRXhlY3V0YWJsZVByb21pc2UuZnJvbUZuKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IGdldFNuYXBzaG90KGdldFNlbGVjdG9yLCBjYWxsc2l0ZSwgU2VsZWN0b3JCdWlsZGVyLCB0cnVlKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiAhIXNuYXBzaG90ICYmIHNuYXBzaG90W1ZJU0lCTEVfUFJPUF9OQU1FXTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRDdXN0b21NZXRob2RzIChvYmosIGdldFNlbGVjdG9yLCBTZWxlY3RvckJ1aWxkZXIsIGN1c3RvbU1ldGhvZHMpIHtcbiAgICBjb25zdCBjdXN0b21NZXRob2RQcm9wcyA9IGN1c3RvbU1ldGhvZHMgPyBPYmplY3Qua2V5cyhjdXN0b21NZXRob2RzKSA6IFtdO1xuXG4gICAgY3VzdG9tTWV0aG9kUHJvcHMuZm9yRWFjaChwcm9wID0+IHtcbiAgICAgICAgY29uc3QgeyByZXR1cm5ET01Ob2RlcyA9IGZhbHNlLCBtZXRob2QgfSA9IGN1c3RvbU1ldGhvZHNbcHJvcF07XG5cbiAgICAgICAgY29uc3QgZGVwZW5kZW5jaWVzID0ge1xuICAgICAgICAgICAgY3VzdG9tTWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgICBzZWxlY3RvcjogICAgIGdldFNlbGVjdG9yKClcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBjYWxsc2l0ZU5hbWVzID0geyBpbnN0YW50aWF0aW9uOiBwcm9wIH07XG5cbiAgICAgICAgaWYgKHJldHVybkRPTU5vZGVzKSB7XG4gICAgICAgICAgICBvYmpbcHJvcF0gPSAoLi4uYXJncykgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNlbGVjdG9yRm4gPSAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLXVuZGVmICovXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IG5vZGVzID0gc2VsZWN0b3IoKTtcblxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gY3VzdG9tTWV0aG9kLmFwcGx5KGN1c3RvbU1ldGhvZCwgW25vZGVzXS5jb25jYXQoYXJncykpO1xuICAgICAgICAgICAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLXVuZGVmICovXG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IGFwaUZuID0gcHJlcGFyZUFwaUZuQXJncyhwcm9wLCAuLi5hcmdzKTtcbiAgICAgICAgICAgICAgICBjb25zdCBmaWx0ZXIgPSAoKSA9PiB0cnVlO1xuXG4gICAgICAgICAgICAgICAgY29uc3QgYWRkaXRpb25hbERlcGVuZGVuY2llcyA9IHtcbiAgICAgICAgICAgICAgICAgICAgYXJncyxcbiAgICAgICAgICAgICAgICAgICAgY3VzdG9tTWV0aG9kOiBtZXRob2RcbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGNyZWF0ZURlcml2YXRpdmVTZWxlY3RvcldpdGhGaWx0ZXIoeyBnZXRTZWxlY3RvciwgU2VsZWN0b3JCdWlsZGVyLCBzZWxlY3RvckZuLCBhcGlGbiwgZmlsdGVyLCBhZGRpdGlvbmFsRGVwZW5kZW5jaWVzIH0pO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIG9ialtwcm9wXSA9IChuZXcgQ2xpZW50RnVuY3Rpb25CdWlsZGVyKCguLi5hcmdzKSA9PiB7XG4gICAgICAgICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgICAgICAgICBjb25zdCBub2RlID0gc2VsZWN0b3IoKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiBjdXN0b21NZXRob2QuYXBwbHkoY3VzdG9tTWV0aG9kLCBbbm9kZV0uY29uY2F0KGFyZ3MpKTtcbiAgICAgICAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLXVuZGVmICovXG4gICAgICAgICAgICB9LCB7IGRlcGVuZGVuY2llcyB9LCBjYWxsc2l0ZU5hbWVzKSkuZ2V0RnVuY3Rpb24oKTtcbiAgICAgICAgfVxuICAgIH0pO1xufVxuXG5mdW5jdGlvbiBwcmVwYXJlU25hcHNob3RQcm9wZXJ0eUxpc3QgKGN1c3RvbURPTVByb3BlcnRpZXMpIHtcbiAgICBsZXQgcHJvcGVydGllcyA9IFsuLi5TTkFQU0hPVF9QUk9QRVJUSUVTXTtcblxuICAgIC8vIE5PVEU6IFRoZSAndmlzaWJsZScgc25hcHNob3QgcHJvcGVydHkgaGFzIGEgc2VwYXJhdGUgaGFuZGxlci5cbiAgICByZW1vdmUocHJvcGVydGllcywgVklTSUJMRV9QUk9QX05BTUUpO1xuXG4gICAgaWYgKGN1c3RvbURPTVByb3BlcnRpZXMpXG4gICAgICAgIHByb3BlcnRpZXMgPSBwcm9wZXJ0aWVzLmNvbmNhdChPYmplY3Qua2V5cyhjdXN0b21ET01Qcm9wZXJ0aWVzKSk7XG5cbiAgICByZXR1cm4gcHJvcGVydGllcztcbn1cblxuZnVuY3Rpb24gYWRkU25hcHNob3RQcm9wZXJ0eVNob3J0aGFuZHMgKHsgb2JqLCBnZXRTZWxlY3RvciwgU2VsZWN0b3JCdWlsZGVyLCBjdXN0b21ET01Qcm9wZXJ0aWVzLCBjdXN0b21NZXRob2RzLCBvYnNlcnZlZENhbGxzaXRlcyB9KSB7XG4gICAgY29uc3QgcHJvcGVydGllcyA9IHByZXBhcmVTbmFwc2hvdFByb3BlcnR5TGlzdChjdXN0b21ET01Qcm9wZXJ0aWVzKTtcblxuICAgIGFkZFNuYXBzaG90UHJvcGVydGllcyhvYmosIGdldFNlbGVjdG9yLCBTZWxlY3RvckJ1aWxkZXIsIHByb3BlcnRpZXMsIG9ic2VydmVkQ2FsbHNpdGVzKTtcbiAgICBhZGRDdXN0b21NZXRob2RzKG9iaiwgZ2V0U2VsZWN0b3IsIFNlbGVjdG9yQnVpbGRlciwgY3VzdG9tTWV0aG9kcyk7XG5cbiAgICBvYmouZ2V0U3R5bGVQcm9wZXJ0eSA9IHByb3AgPT4ge1xuICAgICAgICBjb25zdCBjYWxsc2l0ZSA9IGdldENhbGxzaXRlRm9yTWV0aG9kKCdnZXRTdHlsZVByb3BlcnR5Jyk7XG5cbiAgICAgICAgcmV0dXJuIFJlRXhlY3V0YWJsZVByb21pc2UuZnJvbUZuKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgZ2V0U25hcHNob3QoZ2V0U2VsZWN0b3IsIGNhbGxzaXRlLCBTZWxlY3RvckJ1aWxkZXIpO1xuXG4gICAgICAgICAgICByZXR1cm4gc25hcHNob3Quc3R5bGUgPyBzbmFwc2hvdC5zdHlsZVtwcm9wXSA6IHZvaWQgMDtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIG9iai5nZXRBdHRyaWJ1dGUgPSBhdHRyTmFtZSA9PiB7XG4gICAgICAgIGNvbnN0IGNhbGxzaXRlID0gZ2V0Q2FsbHNpdGVGb3JNZXRob2QoJ2dldEF0dHJpYnV0ZScpO1xuXG4gICAgICAgIHJldHVybiBSZUV4ZWN1dGFibGVQcm9taXNlLmZyb21Gbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IGdldFNuYXBzaG90KGdldFNlbGVjdG9yLCBjYWxsc2l0ZSwgU2VsZWN0b3JCdWlsZGVyKTtcblxuICAgICAgICAgICAgcmV0dXJuIHNuYXBzaG90LmF0dHJpYnV0ZXMgPyBzbmFwc2hvdC5hdHRyaWJ1dGVzW2F0dHJOYW1lXSA6IHZvaWQgMDtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIG9iai5oYXNBdHRyaWJ1dGUgPSBhdHRyTmFtZSA9PiB7XG4gICAgICAgIGNvbnN0IGNhbGxzaXRlID0gZ2V0Q2FsbHNpdGVGb3JNZXRob2QoJ2hhc0F0dHJpYnV0ZScpO1xuXG4gICAgICAgIHJldHVybiBSZUV4ZWN1dGFibGVQcm9taXNlLmZyb21Gbihhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzbmFwc2hvdCA9IGF3YWl0IGdldFNuYXBzaG90KGdldFNlbGVjdG9yLCBjYWxsc2l0ZSwgU2VsZWN0b3JCdWlsZGVyKTtcblxuICAgICAgICAgICAgcmV0dXJuIHNuYXBzaG90LmF0dHJpYnV0ZXMgPyBzbmFwc2hvdC5hdHRyaWJ1dGVzLmhhc093blByb3BlcnR5KGF0dHJOYW1lKSA6IGZhbHNlO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgb2JqLmdldEJvdW5kaW5nQ2xpZW50UmVjdFByb3BlcnR5ID0gcHJvcCA9PiB7XG4gICAgICAgIGNvbnN0IGNhbGxzaXRlID0gZ2V0Q2FsbHNpdGVGb3JNZXRob2QoJ2dldEJvdW5kaW5nQ2xpZW50UmVjdFByb3BlcnR5Jyk7XG5cbiAgICAgICAgcmV0dXJuIFJlRXhlY3V0YWJsZVByb21pc2UuZnJvbUZuKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgZ2V0U25hcHNob3QoZ2V0U2VsZWN0b3IsIGNhbGxzaXRlLCBTZWxlY3RvckJ1aWxkZXIpO1xuXG4gICAgICAgICAgICByZXR1cm4gc25hcHNob3QuYm91bmRpbmdDbGllbnRSZWN0ID8gc25hcHNob3QuYm91bmRpbmdDbGllbnRSZWN0W3Byb3BdIDogdm9pZCAwO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgb2JqLmhhc0NsYXNzID0gbmFtZSA9PiB7XG4gICAgICAgIGNvbnN0IGNhbGxzaXRlID0gZ2V0Q2FsbHNpdGVGb3JNZXRob2QoJ2hhc0NsYXNzJyk7XG5cbiAgICAgICAgcmV0dXJuIFJlRXhlY3V0YWJsZVByb21pc2UuZnJvbUZuKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHNuYXBzaG90ID0gYXdhaXQgZ2V0U25hcHNob3QoZ2V0U2VsZWN0b3IsIGNhbGxzaXRlLCBTZWxlY3RvckJ1aWxkZXIpO1xuXG4gICAgICAgICAgICByZXR1cm4gc25hcHNob3QuY2xhc3NOYW1lcyA/IHNuYXBzaG90LmNsYXNzTmFtZXMuaW5kZXhPZihuYW1lKSA+IC0xIDogZmFsc2U7XG4gICAgICAgIH0pO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUNvdW50ZXIgKGdldFNlbGVjdG9yLCBTZWxlY3RvckJ1aWxkZXIpIHtcbiAgICBjb25zdCBidWlsZGVyICA9IG5ldyBTZWxlY3RvckJ1aWxkZXIoZ2V0U2VsZWN0b3IoKSwgeyBjb3VudGVyTW9kZTogdHJ1ZSB9LCB7IGluc3RhbnRpYXRpb246ICdTZWxlY3RvcicgfSk7XG4gICAgY29uc3QgY291bnRlciAgPSBidWlsZGVyLmdldEZ1bmN0aW9uKCk7XG4gICAgY29uc3QgY2FsbHNpdGUgPSBnZXRDYWxsc2l0ZUZvck1ldGhvZCgnZ2V0Jyk7XG5cbiAgICByZXR1cm4gYXN5bmMgKCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGNvdW50ZXIoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNhdGNoIChlcnIpIHtcbiAgICAgICAgICAgIGVyci5jYWxsc2l0ZSA9IGNhbGxzaXRlO1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgfTtcbn1cblxuZnVuY3Rpb24gYWRkQ291bnRlclByb3BlcnRpZXMgKHsgb2JqLCBnZXRTZWxlY3RvciwgU2VsZWN0b3JCdWlsZGVyIH0pIHtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCAnY291bnQnLCB7XG4gICAgICAgIGdldDogKCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgY291bnRlciA9IGNyZWF0ZUNvdW50ZXIoZ2V0U2VsZWN0b3IsIFNlbGVjdG9yQnVpbGRlcik7XG5cbiAgICAgICAgICAgIHJldHVybiBSZUV4ZWN1dGFibGVQcm9taXNlLmZyb21GbigoKSA9PiBjb3VudGVyKCkpO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCAnZXhpc3RzJywge1xuICAgICAgICBnZXQ6ICgpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGNvdW50ZXIgPSBjcmVhdGVDb3VudGVyKGdldFNlbGVjdG9yLCBTZWxlY3RvckJ1aWxkZXIpO1xuXG4gICAgICAgICAgICByZXR1cm4gUmVFeGVjdXRhYmxlUHJvbWlzZS5mcm9tRm4oYXN5bmMgKCkgPT4gYXdhaXQgY291bnRlcigpID4gMCk7XG4gICAgICAgIH1cbiAgICB9KTtcbn1cblxuZnVuY3Rpb24gY29udmVydEZpbHRlclRvQ2xpZW50RnVuY3Rpb25JZk5lY2Vzc2FyeSAoY2FsbHNpdGVOYW1lLCBmaWx0ZXIsIGRlcGVuZGVuY2llcykge1xuICAgIGlmICh0eXBlb2YgZmlsdGVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBmaWx0ZXJbY2xpZW50RnVuY3Rpb25CdWlsZGVyU3ltYm9sXTtcbiAgICAgICAgY29uc3QgZm4gICAgICA9IGJ1aWxkZXIgPyBidWlsZGVyLmZuIDogZmlsdGVyO1xuICAgICAgICBjb25zdCBvcHRpb25zID0gYnVpbGRlciA/IGFzc2lnbih7fSwgYnVpbGRlci5vcHRpb25zLCB7IGRlcGVuZGVuY2llcyB9KSA6IHsgZGVwZW5kZW5jaWVzIH07XG5cbiAgICAgICAgcmV0dXJuIChuZXcgQ2xpZW50RnVuY3Rpb25CdWlsZGVyKGZuLCBvcHRpb25zLCB7IGluc3RhbnRpYXRpb246IGNhbGxzaXRlTmFtZSB9KSkuZ2V0RnVuY3Rpb24oKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZmlsdGVyO1xufVxuXG5mdW5jdGlvbiBjcmVhdGVEZXJpdmF0aXZlU2VsZWN0b3JXaXRoRmlsdGVyICh7IGdldFNlbGVjdG9yLCBTZWxlY3RvckJ1aWxkZXIsIHNlbGVjdG9yRm4sIGFwaUZuLCBmaWx0ZXIsIGFkZGl0aW9uYWxEZXBlbmRlbmNpZXMgfSkge1xuICAgIGNvbnN0IGNvbGxlY3Rpb25Nb2RlU2VsZWN0b3JCdWlsZGVyID0gbmV3IFNlbGVjdG9yQnVpbGRlcihnZXRTZWxlY3RvcigpLCB7IGNvbGxlY3Rpb25Nb2RlOiB0cnVlIH0pO1xuICAgIGNvbnN0IGN1c3RvbURPTVByb3BlcnRpZXMgICAgICAgICAgID0gY29sbGVjdGlvbk1vZGVTZWxlY3RvckJ1aWxkZXIub3B0aW9ucy5jdXN0b21ET01Qcm9wZXJ0aWVzO1xuICAgIGNvbnN0IGN1c3RvbU1ldGhvZHMgICAgICAgICAgICAgICAgID0gY29sbGVjdGlvbk1vZGVTZWxlY3RvckJ1aWxkZXIub3B0aW9ucy5jdXN0b21NZXRob2RzO1xuXG4gICAgbGV0IGRlcGVuZGVuY2llcyA9IHtcbiAgICAgICAgc2VsZWN0b3I6ICAgIGNvbGxlY3Rpb25Nb2RlU2VsZWN0b3JCdWlsZGVyLmdldEZ1bmN0aW9uKCksXG4gICAgICAgIGZpbHRlcjogICAgICBmaWx0ZXIsXG4gICAgICAgIGZpbHRlck5vZGVzOiBmaWx0ZXJOb2Rlc1xuICAgIH07XG5cbiAgICBjb25zdCB7IGJvdW5kVGVzdFJ1biwgdGltZW91dCwgdmlzaWJpbGl0eUNoZWNrLCBhcGlGbkNoYWluIH0gPSBjb2xsZWN0aW9uTW9kZVNlbGVjdG9yQnVpbGRlci5vcHRpb25zO1xuXG4gICAgZGVwZW5kZW5jaWVzID0gYXNzaWduKGRlcGVuZGVuY2llcywgYWRkaXRpb25hbERlcGVuZGVuY2llcyk7XG5cbiAgICBjb25zdCBidWlsZGVyID0gbmV3IFNlbGVjdG9yQnVpbGRlcihzZWxlY3RvckZuLCB7XG4gICAgICAgIGRlcGVuZGVuY2llcyxcbiAgICAgICAgY3VzdG9tRE9NUHJvcGVydGllcyxcbiAgICAgICAgY3VzdG9tTWV0aG9kcyxcbiAgICAgICAgYm91bmRUZXN0UnVuLFxuICAgICAgICB0aW1lb3V0LFxuICAgICAgICB2aXNpYmlsaXR5Q2hlY2ssXG4gICAgICAgIGFwaUZuQ2hhaW4sXG4gICAgICAgIGFwaUZuXG4gICAgfSwgeyBpbnN0YW50aWF0aW9uOiAnU2VsZWN0b3InIH0pO1xuXG4gICAgcmV0dXJuIGJ1aWxkZXIuZ2V0RnVuY3Rpb24oKTtcbn1cblxuY29uc3QgZmlsdGVyQnlUZXh0ID0gY29udmVydEZpbHRlclRvQ2xpZW50RnVuY3Rpb25JZk5lY2Vzc2FyeSgnZmlsdGVyJywgc2VsZWN0b3JUZXh0RmlsdGVyKTtcbmNvbnN0IGZpbHRlckJ5QXR0ciA9IGNvbnZlcnRGaWx0ZXJUb0NsaWVudEZ1bmN0aW9uSWZOZWNlc3NhcnkoJ2ZpbHRlcicsIHNlbGVjdG9yQXR0cmlidXRlRmlsdGVyKTtcblxuZnVuY3Rpb24gZW5zdXJlUmVnRXhwQ29udGV4dCAoc3RyKSB7XG4gICAgLy8gTk9URTogaWYgYSByZWdleHAgaXMgY3JlYXRlZCBpbiBhIHNlcGFyYXRlIGNvbnRleHQgKHZpYSB0aGUgJ3ZtJyBtb2R1bGUpIHdlXG4gICAgLy8gc2hvdWxkIHdyYXAgaXQgd2l0aCBuZXcgUmVnRXhwKCkgdG8gbWFrZSB0aGUgYGluc3RhbmNlb2YgUmVnRXhwYCBjaGVjayBzdWNjZXNzZnVsLlxuICAgIGlmICh0eXBlb2Ygc3RyICE9PSAnc3RyaW5nJyAmJiAhKHN0ciBpbnN0YW5jZW9mIFJlZ0V4cCkpXG4gICAgICAgIHJldHVybiBuZXcgUmVnRXhwKHN0cik7XG5cbiAgICByZXR1cm4gc3RyO1xufVxuXG5mdW5jdGlvbiBhZGRGaWx0ZXJNZXRob2RzIChvcHRpb25zKSB7XG4gICAgY29uc3QgeyBvYmosIGdldFNlbGVjdG9yLCBTZWxlY3RvckJ1aWxkZXIgfSA9IG9wdGlvbnM7XG5cbiAgICBvYmoubnRoID0gaW5kZXggPT4ge1xuICAgICAgICBhc3NlcnRUeXBlKGlzLm51bWJlciwgJ250aCcsICdcImluZGV4XCIgYXJndW1lbnQnLCBpbmRleCk7XG5cbiAgICAgICAgY29uc3QgYXBpRm4gICA9IHByZXBhcmVBcGlGbkFyZ3MoJ250aCcsIGluZGV4KTtcbiAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBTZWxlY3RvckJ1aWxkZXIoZ2V0U2VsZWN0b3IoKSwgeyBpbmRleCwgYXBpRm4gfSwgeyBpbnN0YW50aWF0aW9uOiAnU2VsZWN0b3InIH0pO1xuXG4gICAgICAgIHJldHVybiBidWlsZGVyLmdldEZ1bmN0aW9uKCk7XG4gICAgfTtcblxuICAgIG9iai53aXRoVGV4dCA9IHRleHQgPT4ge1xuICAgICAgICBhc3NlcnRUeXBlKFtpcy5zdHJpbmcsIGlzLnJlZ0V4cF0sICd3aXRoVGV4dCcsICdcInRleHRcIiBhcmd1bWVudCcsIHRleHQpO1xuXG4gICAgICAgIGNvbnN0IGFwaUZuID0gcHJlcGFyZUFwaUZuQXJncygnd2l0aFRleHQnLCB0ZXh0KTtcblxuICAgICAgICB0ZXh0ID0gZW5zdXJlUmVnRXhwQ29udGV4dCh0ZXh0KTtcblxuICAgICAgICBjb25zdCBzZWxlY3RvckZuID0gKCkgPT4ge1xuICAgICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgICAgIGNvbnN0IG5vZGVzID0gc2VsZWN0b3IoKTtcblxuICAgICAgICAgICAgaWYgKCFub2Rlcy5sZW5ndGgpXG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgICAgIHJldHVybiBmaWx0ZXJOb2Rlcyhub2RlcywgZmlsdGVyLCBkb2N1bWVudCwgdm9pZCAwLCB0ZXh0UmUpO1xuICAgICAgICAgICAgLyogZXNsaW50LWVuYWJsZSBuby11bmRlZiAqL1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGFyZ3MgPSBnZXREZXJpdmF0aXZlU2VsZWN0b3JBcmdzKG9wdGlvbnMsIHNlbGVjdG9yRm4sIGFwaUZuLCBmaWx0ZXJCeVRleHQsIHsgdGV4dFJlOiBtYWtlUmVnRXhwKHRleHQpIH0pO1xuXG4gICAgICAgIHJldHVybiBjcmVhdGVEZXJpdmF0aXZlU2VsZWN0b3JXaXRoRmlsdGVyKGFyZ3MpO1xuICAgIH07XG5cbiAgICBvYmoud2l0aEV4YWN0VGV4dCA9IHRleHQgPT4ge1xuICAgICAgICBhc3NlcnRUeXBlKGlzLnN0cmluZywgJ3dpdGhFeGFjdFRleHQnLCAnXCJ0ZXh0XCIgYXJndW1lbnQnLCB0ZXh0KTtcblxuICAgICAgICBjb25zdCBzZWxlY3RvckZuID0gKCkgPT4ge1xuICAgICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgICAgIGNvbnN0IG5vZGVzID0gc2VsZWN0b3IoKTtcblxuICAgICAgICAgICAgaWYgKCFub2Rlcy5sZW5ndGgpXG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgICAgIHJldHVybiBmaWx0ZXJOb2Rlcyhub2RlcywgZmlsdGVyLCBkb2N1bWVudCwgdm9pZCAwLCBleGFjdFRleHQpO1xuICAgICAgICAgICAgLyogZXNsaW50LWVuYWJsZSBuby11bmRlZiAqL1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGFwaUZuID0gcHJlcGFyZUFwaUZuQXJncygnd2l0aEV4YWN0VGV4dCcsIHRleHQpO1xuICAgICAgICBjb25zdCBhcmdzICA9IGdldERlcml2YXRpdmVTZWxlY3RvckFyZ3Mob3B0aW9ucywgc2VsZWN0b3JGbiwgYXBpRm4sIGZpbHRlckJ5VGV4dCwgeyBleGFjdFRleHQ6IHRleHQgfSk7XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZURlcml2YXRpdmVTZWxlY3RvcldpdGhGaWx0ZXIoYXJncyk7XG4gICAgfTtcblxuICAgIG9iai53aXRoQXR0cmlidXRlID0gKGF0dHJOYW1lLCBhdHRyVmFsdWUpID0+IHtcbiAgICAgICAgYXNzZXJ0VHlwZShbaXMuc3RyaW5nLCBpcy5yZWdFeHBdLCAnd2l0aEF0dHJpYnV0ZScsICdcImF0dHJOYW1lXCIgYXJndW1lbnQnLCBhdHRyTmFtZSk7XG5cbiAgICAgICAgY29uc3QgYXBpRm4gPSBwcmVwYXJlQXBpRm5BcmdzKCd3aXRoQXR0cmlidXRlJywgYXR0ck5hbWUsIGF0dHJWYWx1ZSk7XG5cbiAgICAgICAgYXR0ck5hbWUgPSBlbnN1cmVSZWdFeHBDb250ZXh0KGF0dHJOYW1lKTtcblxuICAgICAgICBpZiAoYXR0clZhbHVlICE9PSB2b2lkIDApIHtcbiAgICAgICAgICAgIGFzc2VydFR5cGUoW2lzLnN0cmluZywgaXMucmVnRXhwXSwgJ3dpdGhBdHRyaWJ1dGUnLCAnXCJhdHRyVmFsdWVcIiBhcmd1bWVudCcsIGF0dHJWYWx1ZSk7XG4gICAgICAgICAgICBhdHRyVmFsdWUgPSBlbnN1cmVSZWdFeHBDb250ZXh0KGF0dHJWYWx1ZSk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWxlY3RvckZuID0gKCkgPT4ge1xuICAgICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgICAgIGNvbnN0IG5vZGVzID0gc2VsZWN0b3IoKTtcblxuICAgICAgICAgICAgaWYgKCFub2Rlcy5sZW5ndGgpXG4gICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgICAgIHJldHVybiBmaWx0ZXJOb2Rlcyhub2RlcywgZmlsdGVyLCBkb2N1bWVudCwgdm9pZCAwLCBhdHRyTmFtZSwgYXR0clZhbHVlKTtcbiAgICAgICAgICAgIC8qIGVzbGludC1lbmFibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBhcmdzID0gZ2V0RGVyaXZhdGl2ZVNlbGVjdG9yQXJncyhvcHRpb25zLCBzZWxlY3RvckZuLCBhcGlGbiwgZmlsdGVyQnlBdHRyLCB7XG4gICAgICAgICAgICBhdHRyTmFtZSxcbiAgICAgICAgICAgIGF0dHJWYWx1ZVxuICAgICAgICB9KTtcblxuICAgICAgICByZXR1cm4gY3JlYXRlRGVyaXZhdGl2ZVNlbGVjdG9yV2l0aEZpbHRlcihhcmdzKTtcbiAgICB9O1xuXG4gICAgb2JqLmZpbHRlciA9IChmaWx0ZXIsIGRlcGVuZGVuY2llcykgPT4ge1xuICAgICAgICBhc3NlcnRUeXBlKFtpcy5zdHJpbmcsIGlzLmZ1bmN0aW9uXSwgJ2ZpbHRlcicsICdcImZpbHRlclwiIGFyZ3VtZW50JywgZmlsdGVyKTtcblxuICAgICAgICBjb25zdCBhcGlGbiA9IHByZXBhcmVBcGlGbkFyZ3MoJ2ZpbHRlcicsIGZpbHRlcik7XG5cbiAgICAgICAgZmlsdGVyID0gY29udmVydEZpbHRlclRvQ2xpZW50RnVuY3Rpb25JZk5lY2Vzc2FyeSgnZmlsdGVyJywgZmlsdGVyLCBkZXBlbmRlbmNpZXMpO1xuXG4gICAgICAgIGNvbnN0IHNlbGVjdG9yRm4gPSAoKSA9PiB7XG4gICAgICAgICAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby11bmRlZiAqL1xuICAgICAgICAgICAgY29uc3Qgbm9kZXMgPSBzZWxlY3RvcigpO1xuXG4gICAgICAgICAgICBpZiAoIW5vZGVzLmxlbmd0aClcbiAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcblxuICAgICAgICAgICAgcmV0dXJuIGZpbHRlck5vZGVzKG5vZGVzLCBmaWx0ZXIsIGRvY3VtZW50LCB2b2lkIDApO1xuICAgICAgICAgICAgLyogZXNsaW50LWVuYWJsZSBuby11bmRlZiAqL1xuICAgICAgICB9O1xuXG5cbiAgICAgICAgY29uc3QgYXJncyA9IGdldERlcml2YXRpdmVTZWxlY3RvckFyZ3Mob3B0aW9ucywgc2VsZWN0b3JGbiwgYXBpRm4sIGZpbHRlcik7XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZURlcml2YXRpdmVTZWxlY3RvcldpdGhGaWx0ZXIoYXJncyk7XG4gICAgfTtcblxuICAgIG9iai5maWx0ZXJWaXNpYmxlID0gKCkgPT4ge1xuICAgICAgICBjb25zdCBhcGlGbiAgID0gcHJlcGFyZUFwaUZuQXJncygnZmlsdGVyVmlzaWJsZScpO1xuICAgICAgICBjb25zdCBidWlsZGVyID0gbmV3IFNlbGVjdG9yQnVpbGRlcihnZXRTZWxlY3RvcigpLCB7IGZpbHRlclZpc2libGU6IHRydWUsIGFwaUZuIH0sIHsgaW5zdGFudGlhdGlvbjogJ1NlbGVjdG9yJyB9KTtcblxuICAgICAgICByZXR1cm4gYnVpbGRlci5nZXRGdW5jdGlvbigpO1xuICAgIH07XG5cbiAgICBvYmouZmlsdGVySGlkZGVuID0gKCkgPT4ge1xuICAgICAgICBjb25zdCBhcGlGbiAgID0gcHJlcGFyZUFwaUZuQXJncygnZmlsdGVySGlkZGVuJyk7XG4gICAgICAgIGNvbnN0IGJ1aWxkZXIgPSBuZXcgU2VsZWN0b3JCdWlsZGVyKGdldFNlbGVjdG9yKCksIHsgZmlsdGVySGlkZGVuOiB0cnVlLCBhcGlGbiB9LCB7IGluc3RhbnRpYXRpb246ICdTZWxlY3RvcicgfSk7XG5cbiAgICAgICAgcmV0dXJuIGJ1aWxkZXIuZ2V0RnVuY3Rpb24oKTtcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBhZGRDdXN0b21ET01Qcm9wZXJ0aWVzTWV0aG9kICh7IG9iaiwgZ2V0U2VsZWN0b3IsIFNlbGVjdG9yQnVpbGRlciB9KSB7XG4gICAgb2JqLmFkZEN1c3RvbURPTVByb3BlcnRpZXMgPSBjdXN0b21ET01Qcm9wZXJ0aWVzID0+IHtcbiAgICAgICAgYXNzZXJ0QWRkQ3VzdG9tRE9NUHJvcGVydGllc09wdGlvbnMoY3VzdG9tRE9NUHJvcGVydGllcyk7XG5cbiAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBTZWxlY3RvckJ1aWxkZXIoZ2V0U2VsZWN0b3IoKSwgeyBjdXN0b21ET01Qcm9wZXJ0aWVzIH0sIHsgaW5zdGFudGlhdGlvbjogJ1NlbGVjdG9yJyB9KTtcblxuICAgICAgICByZXR1cm4gYnVpbGRlci5nZXRGdW5jdGlvbigpO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGFkZEN1c3RvbU1ldGhvZHNNZXRob2QgKHsgb2JqLCBnZXRTZWxlY3RvciwgU2VsZWN0b3JCdWlsZGVyIH0pIHtcbiAgICBvYmouYWRkQ3VzdG9tTWV0aG9kcyA9IGZ1bmN0aW9uIChtZXRob2RzLCBvcHRzKSB7XG4gICAgICAgIGFzc2VydEFkZEN1c3RvbU1ldGhvZHMobWV0aG9kcywgb3B0cyk7XG5cbiAgICAgICAgY29uc3QgY3VzdG9tTWV0aG9kcyA9IHt9O1xuXG4gICAgICAgIE9iamVjdC5rZXlzKG1ldGhvZHMpLmZvckVhY2gobWV0aG9kTmFtZSA9PiB7XG4gICAgICAgICAgICBjdXN0b21NZXRob2RzW21ldGhvZE5hbWVdID0ge1xuICAgICAgICAgICAgICAgIG1ldGhvZDogICAgICAgICBtZXRob2RzW21ldGhvZE5hbWVdLFxuICAgICAgICAgICAgICAgIHJldHVybkRPTU5vZGVzOiBvcHRzICYmICEhb3B0cy5yZXR1cm5ET01Ob2Rlc1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgY29uc3QgYnVpbGRlciA9IG5ldyBTZWxlY3RvckJ1aWxkZXIoZ2V0U2VsZWN0b3IoKSwgeyBjdXN0b21NZXRob2RzIH0sIHsgaW5zdGFudGlhdGlvbjogJ1NlbGVjdG9yJyB9KTtcblxuICAgICAgICByZXR1cm4gYnVpbGRlci5nZXRGdW5jdGlvbigpO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIGFkZEhpZXJhcmNoaWNhbFNlbGVjdG9ycyAob3B0aW9ucykge1xuICAgIGNvbnN0IHsgb2JqIH0gPSBvcHRpb25zO1xuXG4gICAgLy8gRmluZFxuICAgIG9iai5maW5kID0gKGZpbHRlciwgZGVwZW5kZW5jaWVzKSA9PiB7XG4gICAgICAgIGFzc2VydFR5cGUoW2lzLnN0cmluZywgaXMuZnVuY3Rpb25dLCAnZmluZCcsICdcImZpbHRlclwiIGFyZ3VtZW50JywgZmlsdGVyKTtcblxuICAgICAgICBjb25zdCBhcGlGbiA9IHByZXBhcmVBcGlGbkFyZ3MoJ2ZpbmQnLCBmaWx0ZXIpO1xuXG4gICAgICAgIGZpbHRlciA9IGNvbnZlcnRGaWx0ZXJUb0NsaWVudEZ1bmN0aW9uSWZOZWNlc3NhcnkoJ2ZpbmQnLCBmaWx0ZXIsIGRlcGVuZGVuY2llcyk7XG5cbiAgICAgICAgY29uc3Qgc2VsZWN0b3JGbiA9ICgpID0+IHtcbiAgICAgICAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLXVuZGVmICovXG4gICAgICAgICAgICByZXR1cm4gZXhwYW5kU2VsZWN0b3JSZXN1bHRzKHNlbGVjdG9yLCBub2RlID0+IHtcbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIGZpbHRlciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHR5cGVvZiBub2RlLnF1ZXJ5U2VsZWN0b3JBbGwgPT09ICdmdW5jdGlvbicgP1xuICAgICAgICAgICAgICAgICAgICAgICAgbm9kZS5xdWVyeVNlbGVjdG9yQWxsKGZpbHRlcikgOlxuICAgICAgICAgICAgICAgICAgICAgICAgbnVsbDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zdCByZXN1bHRzID0gW107XG5cbiAgICAgICAgICAgICAgICBjb25zdCB2aXNpdE5vZGUgPSBjdXJyZW50Tm9kZSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNuTGVuZ3RoID0gY3VycmVudE5vZGUuY2hpbGROb2Rlcy5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjbkxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBjaGlsZCA9IGN1cnJlbnROb2RlLmNoaWxkTm9kZXNbaV07XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdHMucHVzaChjaGlsZCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHZpc2l0Tm9kZShjaGlsZCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgdmlzaXROb2RlKG5vZGUpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlck5vZGVzKHJlc3VsdHMsIGZpbHRlciwgbnVsbCwgbm9kZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIC8qIGVzbGludC1lbmFibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBhcmdzID0gZ2V0RGVyaXZhdGl2ZVNlbGVjdG9yQXJncyhvcHRpb25zLCBzZWxlY3RvckZuLCBhcGlGbiwgZmlsdGVyLCB7IGV4cGFuZFNlbGVjdG9yUmVzdWx0cyB9KTtcblxuICAgICAgICByZXR1cm4gY3JlYXRlRGVyaXZhdGl2ZVNlbGVjdG9yV2l0aEZpbHRlcihhcmdzKTtcbiAgICB9O1xuXG4gICAgLy8gUGFyZW50XG4gICAgb2JqLnBhcmVudCA9IChmaWx0ZXIsIGRlcGVuZGVuY2llcykgPT4ge1xuICAgICAgICBpZiAoZmlsdGVyICE9PSB2b2lkIDApXG4gICAgICAgICAgICBhc3NlcnRUeXBlKFtpcy5zdHJpbmcsIGlzLmZ1bmN0aW9uLCBpcy5udW1iZXJdLCAncGFyZW50JywgJ1wiZmlsdGVyXCIgYXJndW1lbnQnLCBmaWx0ZXIpO1xuXG4gICAgICAgIGNvbnN0IGFwaUZuID0gcHJlcGFyZUFwaUZuQXJncygncGFyZW50JywgZmlsdGVyKTtcblxuICAgICAgICBmaWx0ZXIgPSBjb252ZXJ0RmlsdGVyVG9DbGllbnRGdW5jdGlvbklmTmVjZXNzYXJ5KCdmaW5kJywgZmlsdGVyLCBkZXBlbmRlbmNpZXMpO1xuXG4gICAgICAgIGNvbnN0IHNlbGVjdG9yRm4gPSAoKSA9PiB7XG4gICAgICAgICAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby11bmRlZiAqL1xuICAgICAgICAgICAgcmV0dXJuIGV4cGFuZFNlbGVjdG9yUmVzdWx0cyhzZWxlY3Rvciwgbm9kZSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgcGFyZW50cyA9IFtdO1xuXG4gICAgICAgICAgICAgICAgZm9yIChsZXQgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlOyBwYXJlbnQ7IHBhcmVudCA9IHBhcmVudC5wYXJlbnROb2RlKVxuICAgICAgICAgICAgICAgICAgICBwYXJlbnRzLnB1c2gocGFyZW50KTtcblxuICAgICAgICAgICAgICAgIHJldHVybiBmaWx0ZXIgIT09IHZvaWQgMCA/IGZpbHRlck5vZGVzKHBhcmVudHMsIGZpbHRlciwgZG9jdW1lbnQsIG5vZGUpIDogcGFyZW50cztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgLyogZXNsaW50LWVuYWJsZSBuby11bmRlZiAqL1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IGFyZ3MgPSBnZXREZXJpdmF0aXZlU2VsZWN0b3JBcmdzKG9wdGlvbnMsIHNlbGVjdG9yRm4sIGFwaUZuLCBmaWx0ZXIsIHsgZXhwYW5kU2VsZWN0b3JSZXN1bHRzIH0pO1xuXG4gICAgICAgIHJldHVybiBjcmVhdGVEZXJpdmF0aXZlU2VsZWN0b3JXaXRoRmlsdGVyKGFyZ3MpO1xuICAgIH07XG5cbiAgICAvLyBDaGlsZFxuICAgIG9iai5jaGlsZCA9IChmaWx0ZXIsIGRlcGVuZGVuY2llcykgPT4ge1xuICAgICAgICBpZiAoZmlsdGVyICE9PSB2b2lkIDApXG4gICAgICAgICAgICBhc3NlcnRUeXBlKFtpcy5zdHJpbmcsIGlzLmZ1bmN0aW9uLCBpcy5udW1iZXJdLCAnY2hpbGQnLCAnXCJmaWx0ZXJcIiBhcmd1bWVudCcsIGZpbHRlcik7XG5cbiAgICAgICAgY29uc3QgYXBpRm4gPSBwcmVwYXJlQXBpRm5BcmdzKCdjaGlsZCcsIGZpbHRlcik7XG5cbiAgICAgICAgZmlsdGVyID0gY29udmVydEZpbHRlclRvQ2xpZW50RnVuY3Rpb25JZk5lY2Vzc2FyeSgnZmluZCcsIGZpbHRlciwgZGVwZW5kZW5jaWVzKTtcblxuICAgICAgICBjb25zdCBzZWxlY3RvckZuID0gKCkgPT4ge1xuICAgICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgICAgIHJldHVybiBleHBhbmRTZWxlY3RvclJlc3VsdHMoc2VsZWN0b3IsIG5vZGUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkRWxlbWVudHMgPSBbXTtcbiAgICAgICAgICAgICAgICBjb25zdCBjbkxlbmd0aCAgICAgID0gbm9kZS5jaGlsZE5vZGVzLmxlbmd0aDtcblxuICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY25MZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjaGlsZCA9IG5vZGUuY2hpbGROb2Rlc1tpXTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGQubm9kZVR5cGUgPT09IDEpXG4gICAgICAgICAgICAgICAgICAgICAgICBjaGlsZEVsZW1lbnRzLnB1c2goY2hpbGQpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiBmaWx0ZXIgIT09IHZvaWQgMCA/IGZpbHRlck5vZGVzKGNoaWxkRWxlbWVudHMsIGZpbHRlciwgbm9kZSwgbm9kZSkgOiBjaGlsZEVsZW1lbnRzO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLXVuZGVmICovXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgYXJncyA9IGdldERlcml2YXRpdmVTZWxlY3RvckFyZ3Mob3B0aW9ucywgc2VsZWN0b3JGbiwgYXBpRm4sIGZpbHRlciwgeyBleHBhbmRTZWxlY3RvclJlc3VsdHMgfSk7XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZURlcml2YXRpdmVTZWxlY3RvcldpdGhGaWx0ZXIoYXJncyk7XG4gICAgfTtcblxuICAgIC8vIFNpYmxpbmdcbiAgICBvYmouc2libGluZyA9IChmaWx0ZXIsIGRlcGVuZGVuY2llcykgPT4ge1xuICAgICAgICBpZiAoZmlsdGVyICE9PSB2b2lkIDApXG4gICAgICAgICAgICBhc3NlcnRUeXBlKFtpcy5zdHJpbmcsIGlzLmZ1bmN0aW9uLCBpcy5udW1iZXJdLCAnc2libGluZycsICdcImZpbHRlclwiIGFyZ3VtZW50JywgZmlsdGVyKTtcblxuICAgICAgICBjb25zdCBhcGlGbiA9IHByZXBhcmVBcGlGbkFyZ3MoJ3NpYmxpbmcnLCBmaWx0ZXIpO1xuXG4gICAgICAgIGZpbHRlciA9IGNvbnZlcnRGaWx0ZXJUb0NsaWVudEZ1bmN0aW9uSWZOZWNlc3NhcnkoJ2ZpbmQnLCBmaWx0ZXIsIGRlcGVuZGVuY2llcyk7XG5cbiAgICAgICAgY29uc3Qgc2VsZWN0b3JGbiA9ICgpID0+IHtcbiAgICAgICAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLXVuZGVmICovXG4gICAgICAgICAgICByZXR1cm4gZXhwYW5kU2VsZWN0b3JSZXN1bHRzKHNlbGVjdG9yLCBub2RlID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXBhcmVudClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgICAgICAgICBjb25zdCBzaWJsaW5ncyA9IFtdO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNuTGVuZ3RoID0gcGFyZW50LmNoaWxkTm9kZXMubGVuZ3RoO1xuXG4gICAgICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjbkxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGNoaWxkID0gcGFyZW50LmNoaWxkTm9kZXNbaV07XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGNoaWxkLm5vZGVUeXBlID09PSAxICYmIGNoaWxkICE9PSBub2RlKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2libGluZ3MucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlciAhPT0gdm9pZCAwID8gZmlsdGVyTm9kZXMoc2libGluZ3MsIGZpbHRlciwgcGFyZW50LCBub2RlKSA6IHNpYmxpbmdzO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLXVuZGVmICovXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgYXJncyA9IGdldERlcml2YXRpdmVTZWxlY3RvckFyZ3Mob3B0aW9ucywgc2VsZWN0b3JGbiwgYXBpRm4sIGZpbHRlciwgeyBleHBhbmRTZWxlY3RvclJlc3VsdHMgfSk7XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZURlcml2YXRpdmVTZWxlY3RvcldpdGhGaWx0ZXIoYXJncyk7XG4gICAgfTtcblxuICAgIC8vIE5leHQgc2libGluZ1xuICAgIG9iai5uZXh0U2libGluZyA9IChmaWx0ZXIsIGRlcGVuZGVuY2llcykgPT4ge1xuICAgICAgICBpZiAoZmlsdGVyICE9PSB2b2lkIDApXG4gICAgICAgICAgICBhc3NlcnRUeXBlKFtpcy5zdHJpbmcsIGlzLmZ1bmN0aW9uLCBpcy5udW1iZXJdLCAnbmV4dFNpYmxpbmcnLCAnXCJmaWx0ZXJcIiBhcmd1bWVudCcsIGZpbHRlcik7XG5cbiAgICAgICAgY29uc3QgYXBpRm4gPSBwcmVwYXJlQXBpRm5BcmdzKCduZXh0U2libGluZycsIGZpbHRlcik7XG5cbiAgICAgICAgZmlsdGVyID0gY29udmVydEZpbHRlclRvQ2xpZW50RnVuY3Rpb25JZk5lY2Vzc2FyeSgnZmluZCcsIGZpbHRlciwgZGVwZW5kZW5jaWVzKTtcblxuICAgICAgICBjb25zdCBzZWxlY3RvckZuID0gKCkgPT4ge1xuICAgICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgICAgIHJldHVybiBleHBhbmRTZWxlY3RvclJlc3VsdHMoc2VsZWN0b3IsIG5vZGUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcblxuICAgICAgICAgICAgICAgIGlmICghcGFyZW50KVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHNpYmxpbmdzID0gW107XG4gICAgICAgICAgICAgICAgY29uc3QgY25MZW5ndGggPSBwYXJlbnQuY2hpbGROb2Rlcy5sZW5ndGg7XG4gICAgICAgICAgICAgICAgbGV0IGFmdGVyTm9kZSAgPSBmYWxzZTtcblxuICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY25MZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBjaGlsZCA9IHBhcmVudC5jaGlsZE5vZGVzW2ldO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChjaGlsZCA9PT0gbm9kZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGFmdGVyTm9kZSA9IHRydWU7XG5cbiAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoYWZ0ZXJOb2RlICYmIGNoaWxkLm5vZGVUeXBlID09PSAxKVxuICAgICAgICAgICAgICAgICAgICAgICAgc2libGluZ3MucHVzaChjaGlsZCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlciAhPT0gdm9pZCAwID8gZmlsdGVyTm9kZXMoc2libGluZ3MsIGZpbHRlciwgcGFyZW50LCBub2RlKSA6IHNpYmxpbmdzO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLXVuZGVmICovXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgYXJncyA9IGdldERlcml2YXRpdmVTZWxlY3RvckFyZ3Mob3B0aW9ucywgc2VsZWN0b3JGbiwgYXBpRm4sIGZpbHRlciwgeyBleHBhbmRTZWxlY3RvclJlc3VsdHMgfSk7XG5cbiAgICAgICAgcmV0dXJuIGNyZWF0ZURlcml2YXRpdmVTZWxlY3RvcldpdGhGaWx0ZXIoYXJncyk7XG4gICAgfTtcblxuICAgIC8vIFByZXYgc2libGluZ1xuICAgIG9iai5wcmV2U2libGluZyA9IChmaWx0ZXIsIGRlcGVuZGVuY2llcykgPT4ge1xuICAgICAgICBpZiAoZmlsdGVyICE9PSB2b2lkIDApXG4gICAgICAgICAgICBhc3NlcnRUeXBlKFtpcy5zdHJpbmcsIGlzLmZ1bmN0aW9uLCBpcy5udW1iZXJdLCAncHJldlNpYmxpbmcnLCAnXCJmaWx0ZXJcIiBhcmd1bWVudCcsIGZpbHRlcik7XG5cbiAgICAgICAgY29uc3QgYXBpRm4gPSBwcmVwYXJlQXBpRm5BcmdzKCdwcmV2U2libGluZycsIGZpbHRlcik7XG5cbiAgICAgICAgZmlsdGVyID0gY29udmVydEZpbHRlclRvQ2xpZW50RnVuY3Rpb25JZk5lY2Vzc2FyeSgnZmluZCcsIGZpbHRlciwgZGVwZW5kZW5jaWVzKTtcblxuICAgICAgICBjb25zdCBzZWxlY3RvckZuID0gKCkgPT4ge1xuICAgICAgICAgICAgLyogZXNsaW50LWRpc2FibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgICAgIHJldHVybiBleHBhbmRTZWxlY3RvclJlc3VsdHMoc2VsZWN0b3IsIG5vZGUgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcblxuICAgICAgICAgICAgICAgIGlmICghcGFyZW50KVxuICAgICAgICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHNpYmxpbmdzID0gW107XG4gICAgICAgICAgICAgICAgY29uc3QgY25MZW5ndGggPSBwYXJlbnQuY2hpbGROb2Rlcy5sZW5ndGg7XG5cbiAgICAgICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNuTGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY2hpbGQgPSBwYXJlbnQuY2hpbGROb2Rlc1tpXTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGQgPT09IG5vZGUpXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcblxuICAgICAgICAgICAgICAgICAgICBpZiAoY2hpbGQubm9kZVR5cGUgPT09IDEpXG4gICAgICAgICAgICAgICAgICAgICAgICBzaWJsaW5ncy5wdXNoKGNoaWxkKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gZmlsdGVyICE9PSB2b2lkIDAgPyBmaWx0ZXJOb2RlcyhzaWJsaW5ncywgZmlsdGVyLCBwYXJlbnQsIG5vZGUpIDogc2libGluZ3M7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIC8qIGVzbGludC1lbmFibGUgbm8tdW5kZWYgKi9cbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBhcmdzID0gZ2V0RGVyaXZhdGl2ZVNlbGVjdG9yQXJncyhvcHRpb25zLCBzZWxlY3RvckZuLCBhcGlGbiwgZmlsdGVyLCB7IGV4cGFuZFNlbGVjdG9yUmVzdWx0cyB9KTtcblxuICAgICAgICByZXR1cm4gY3JlYXRlRGVyaXZhdGl2ZVNlbGVjdG9yV2l0aEZpbHRlcihhcmdzKTtcbiAgICB9O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkQVBJIChzZWxlY3RvciwgZ2V0U2VsZWN0b3IsIFNlbGVjdG9yQnVpbGRlciwgY3VzdG9tRE9NUHJvcGVydGllcywgY3VzdG9tTWV0aG9kcywgb2JzZXJ2ZWRDYWxsc2l0ZXMpIHtcbiAgICBjb25zdCBvcHRpb25zID0geyBvYmo6IHNlbGVjdG9yLCBnZXRTZWxlY3RvciwgU2VsZWN0b3JCdWlsZGVyLCBjdXN0b21ET01Qcm9wZXJ0aWVzLCBjdXN0b21NZXRob2RzLCBvYnNlcnZlZENhbGxzaXRlcyB9O1xuXG4gICAgYWRkRmlsdGVyTWV0aG9kcyhvcHRpb25zKTtcbiAgICBhZGRIaWVyYXJjaGljYWxTZWxlY3RvcnMob3B0aW9ucyk7XG4gICAgYWRkU25hcHNob3RQcm9wZXJ0eVNob3J0aGFuZHMob3B0aW9ucyk7XG4gICAgYWRkQ3VzdG9tRE9NUHJvcGVydGllc01ldGhvZChvcHRpb25zKTtcbiAgICBhZGRDdXN0b21NZXRob2RzTWV0aG9kKG9wdGlvbnMpO1xuICAgIGFkZENvdW50ZXJQcm9wZXJ0aWVzKG9wdGlvbnMpO1xuICAgIGFkZFZpc2libGVQcm9wZXJ0eShvcHRpb25zKTtcbn1cbiJdfQ==