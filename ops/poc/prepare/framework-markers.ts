/**
 * Idioms that tell a front-end framework apart in TodoMVC's examples (#62). A framework round offers one family of four
 * frameworks, so a round is fair only when its window shows its own framework's idioms and none that belong to another
 * framework of its family. The second hint quotes what a marker matched in the window, or `shown` where that is prose
 * with its own quotes; `shown` also names the marker in tests and reports. Markers come most telling first. Every
 * framework's name is masked before markers are read, so none matches a name.
 */
export interface FrameworkMarker {
  readonly shown: string;
  readonly pattern: RegExp;
}

const marker = (shown: string, pattern: RegExp): FrameworkMarker => Object.freeze({ shown, pattern });

/** The frameworks a profile may configure, by id, with their markers. */
export const FRAMEWORK_MARKERS: Readonly<Record<string, readonly FrameworkMarker[]>> = Object.freeze({
  react: [
    marker("useState(", /\buseState\(/u), marker("useCallback(", /\buseCallback\(/u), marker("useEffect(", /\buseEffect\(/u),
    marker("useMemo(", /\buseMemo\(/u), marker("useRef(", /\buseRef\(/u), marker("useReducer(", /\buseReducer\(/u),
    marker("className=", /\bclassName=/u), marker("htmlFor=", /\bhtmlFor=/u), marker("memo(", /(?<![.\w])memo\(/u),
    marker("onChange={", /\bonChange=\{/u), marker("onClick={", /\bonClick=\{/u), marker("onBlur={", /\bonBlur=\{/u),
    marker("onDoubleClick={", /\bonDoubleClick=\{/u), marker("onKeyDown={", /\bonKeyDown=\{/u), marker("onSubmit={", /\bonSubmit=\{/u),
    marker("dispatch({", /\bdispatch\(\{/u),
  ],
  vue: [
    marker("v-if=", /\sv-if=/u), marker("v-for=", /\sv-for=/u), marker("v-model=", /\sv-model=/u), marker("v-show=", /\sv-show=/u),
    marker("v-else", /\sv-else(?:-if)?\b/u), marker("defineProps(", /\bdefineProps\(/u), marker("defineEmits(", /\bdefineEmits\(/u),
    marker("nextTick(", /\bnextTick\(/u), marker("$emit(", /\$emit\(/u), marker("emit('", /(?<![.\w$])emit\(['"]/u),
    marker("@click=\"", /\s@[a-z][\w-]*(?:\.[\w-]+)*="/u), marker(":class=\"", /\s:[a-z][\w-]*="/u),
    marker("ref(", /(?<![.\w])ref\(/u), marker("<script setup>", /<script setup>/u),
  ],
  svelte: [
    marker("$state(", /\$state\(/u), marker("$props()", /\$props\(\)/u), marker("$derived(", /\$derived(?:\.by)?\(/u),
    marker("$effect(", /\$effect\(/u), marker("{#if", /\{#if\s/u), marker("{#each", /\{#each\s/u), marker("{:else", /\{:else\b/u),
    marker("{/if}", /\{\/if\}/u), marker("{/each}", /\{\/each\}/u), marker("class:", /\sclass:[\w-]+/u), marker("bind:", /\sbind:\w+/u),
    marker("use:", /\suse:\w+/u), marker("on:", /\son:\w+/u), marker("onclick={", /\son[a-z]+=\{/u), marker("$:", /^\s*\$:/mu),
    marker("export let", /^\s*export\s+let\s/mu), marker("tick()", /\btick\(\)/u),
  ],
  angular: [
    marker("@Component(", /@Component\(/u), marker("@Input(", /@Input\(/u), marker("@Output(", /@Output\(/u),
    marker("@ViewChild(", /@ViewChild\(/u), marker("@Injectable(", /@Injectable\(/u), marker("@HostListener(", /@HostListener\(/u),
    marker("EventEmitter", /\bEventEmitter\b/u), marker("ngAfterViewChecked", /\bng(?:OnInit|OnChanges|OnDestroy|AfterViewInit|AfterViewChecked|DoCheck)\b/u),
    marker("*ngIf", /\*ng(?:If|For)\b/u), marker("[(ngModel)]", /\[\(ngModel\)\]/u), marker("(click)=", /\s\((?:click|dblclick|keyup|keydown|blur|change|input|submit)(?:\.\w+)*\)=/u),
    marker("[class.", /\[class\.[\w-]+\]=/u), marker("@if (", /^\s*@(?:if|for|switch)\s*\(/mu), marker("standalone: true", /\bstandalone:\s*true\b/u),
    marker("templateUrl:", /\btemplateUrl:/u), marker("signal(", /(?<![.\w])signal\(/u), marker("implements", /\bimplements\s+(?:OnInit|OnDestroy|OnChanges|AfterViewInit|AfterViewChecked)\b/u),
  ],
  backbone: [
    marker(".View.extend({", /\.(?:View|Model|Collection|Router)\.extend\(\{/u), marker("this.listenTo(", /\bthis\.listenTo\(/u),
    marker("this.$el", /\bthis\.\$el\b/u), marker("this.$(", /\bthis\.\$\(/u), marker("this.model.", /\bthis\.model\.(?:get|set|save|destroy|toJSON|toggle)\(/u),
    marker("tagName:", /\btagName:\s*['"]/u), marker("_.template(", /\b_\.template\(/u), marker("\"click .toggle\":", /['"](?:click|dblclick|keypress|keydown|keyup|blur|change|focusout)\s+[.#\w][^'"]*['"]\s*:/u),
    marker("routes: {", /\broutes:\s*\{/u), marker("comparator:", /\bcomparator:/u),
  ],
  ember: [
    marker("@tracked", /@tracked\b/u), marker("@service", /@service\b/u), marker("@action", /@action\b/u), marker("{{on \"", /\{\{on\s+["']/u),
    marker("this.args.", /\bthis\.args\./u), marker("{{if ", /\{\{#?if\s/u), marker("{{#each", /\{\{#each\s/u), marker("@todo.", /\{\{@\w+/u),
    marker("<template>", /^\s*<template>\s*$/mu), marker("isBlank(", /\bisBlank\(/u), marker("transitionTo(", /\btransitionTo\(/u),
    marker("extends Route", /\bextends\s+Route\b/u),
  ],
  knockout: [
    marker("ko.observable(", /\bko\.observable\(/u), marker("ko.observableArray(", /\bko\.observableArray\(/u), marker("ko.computed(", /\bko\.(?:pure)?[cC]omputed\(/u),
    marker("ko.", /\bko\.\w+/u), marker("bindingHandlers", /\bbindingHandlers\b/u), marker("valueAccessor", /\bvalueAccessor\b/u),
    marker("data-bind=", /\bdata-bind=/u), marker(".subscribe(", /\.subscribe\(/u),
  ],
  angularjs: [
    marker("$scope", /\$scope\b/u), marker("$watch(", /\$watch(?:Collection|Group)?\(/u), marker("$location", /\$location\b/u),
    marker("$routeProvider", /\$routeProvider\b/u), marker("$timeout", /\$timeout\b/u), marker("$inject", /\$inject\b/u),
    marker(".directive('", /\.directive\(['"]/u), marker(".controller('", /\.(?:controller|factory|service|module|config|filter)\(['"]/u),
    marker("ng-model=", /\sng-[a-z-]+=/u), marker("link: function (scope", /\blink:\s*function\s*\(\s*scope\b/u), marker("restrict:", /\brestrict:\s*['"]/u),
    marker("scope.$apply(", /\.\$(?:apply|on|broadcast|emit|eval)\(/u),
  ],
  preact: [
    marker("useState(", /\buseState\(/u), marker("useEffect(", /\buseEffect\(/u), marker("useRef(", /\buseRef\(/u),
    marker("useCallback(", /\buseCallback\(/u), marker("useMemo(", /\buseMemo\(/u), marker("class={", /<[a-z][\w-]*\b[^<>]*\sclass=\{/u),
    marker("onDblClick={", /\bon[A-Z]\w*=\{/u), marker("this.setState(", /\bthis\.setState\(/u), marker("linkState(", /\blinkState\(/u),
    marker("tags written straight into the script, such as `<li`", /(?:return\s*\(?|\?|:|&&)\s*\n?\s*<[a-z][\w-]*[\s>]/u),
  ],
  lit: [
    marker("the `html` tag on a template literal", /\bhtml`/u), marker("the `css` tag on a template literal", /\bcss`/u), marker("@property(", /@property\(/u), marker("@state(", /@state\(/u),
    marker("@customElement(", /@customElement\(/u), marker("@query(", /@query\(/u), marker(".checked=${", /\s\.\w+=\$\{/u),
    marker("@click=${", /\s@[a-z]+=\$\{/u), marker("?disabled=${", /\s\?\w+=\$\{/u), marker("classMap(", /\bclassMap\(/u),
    marker("static styles", /\bstatic\s+(?:override\s+)?styles\b/u), marker("requestUpdate(", /\brequestUpdate\(/u),
    marker("connectedCallback()", /\bconnectedCallback\(\)/u), marker("updated(", /^\s*(?:override\s+)?(?:updated|firstUpdated|willUpdate)\(/mu),
  ],
  mithril: [
    marker("m('", /(?<![.\w$])m\(\s*['"]/u), marker("m.redraw", /\bm\.redraw\b/u), marker("m.route", /\bm\.route\b/u), marker("m.prop(", /\bm\.prop\(/u),
    marker("m.withAttr(", /\bm\.withAttr\(/u), marker("m.mount(", /\bm\.mount\(/u), marker("vnode.attrs", /\bvnode\.(?:attrs|state|dom)\b/u),
    marker("config: function (element", /\bconfig:\s*function\s*\(\s*element\b/u), marker("view: function", /\bview\s*[:=]\s*function\b/u),
  ],
  ractive: [
    marker("this.get('", /\bthis\.get\(['"]/u), marker("this.set('", /\bthis\.set\(['"]/u), marker(".set('", /\b\w+\.set\(['"]/u),
    marker(".observe('", /\.observe\(['"]/u), marker("this.on('", /\bthis\.on\(['"]/u), marker("fire({", /\bfire\(\{/u),
    marker("el: '", /\bel:\s*['"]/u), marker("template: '#", /\btemplate:\s*['"]#/u), marker("data: {", /\bdata:\s*\{/u),
    marker("on-click=", /\son-[a-z-]+=/u), marker("{{>item}}", /\{\{>\s*\w+/u), marker("{{#items:i}}", /\{\{#\s*[\w.]+:\w+\s*\}\}/u),
    marker("{{#each", /\{\{#each\s/u),
  ],
  dojo: [
    marker("declare([", /\bdeclare\(\s*\[/u), marker("lang.hitch(", /\blang\.hitch\(/u), marker("this.inherited(arguments)", /\bthis\.inherited\(arguments\)/u),
    marker("this.own(", /\bthis\.own\(/u), marker("new Deferred()", /\bnew\s+Deferred\(/u), marker("_WidgetBase", /\b_\w*(?:WidgetBase|TemplatedMixin|WidgetsInTemplateMixin)\b/u),
    marker("postCreate", /\bpostCreate\s*:/u), marker("startup: function", /\bstartup\s*:\s*function/u), marker("domClass.", /\bdom(?:Class|Construct|Style|Attr|Geometry)\.\w+/u),
    marker("registry.byId(", /\bregistry\.by(?:Id|Node)\(/u), marker("at(this", /\bat\(\s*this\b/u),
  ],
  closure: [
    marker("goog.events.", /\bgoog\.events\./u), marker("goog.dom.", /\bgoog\.dom\./u), marker("goog.ui.", /\bgoog\.ui\./u),
    marker("goog.inherits(", /\bgoog\.inherits\(/u), marker("goog.", /\bgoog\.\w+/u), marker(".superClass_", /\.superClass_\b/u),
    marker("getHandler().listen(", /\bgetHandler\(\)\.listen\(/u), marker("opt_", /\bopt_\w+/u),
  ],
  canjs: [
    marker(".Component.extend({", /\.(?:Component|Control|Model|Map|List|Construct)(?:\.\w+)?\.extend\(\{/u), marker(".attr('", /\.attr\(['"]/u),
    marker(".route", /\bmystery\.route\b/u), marker("scope: {", /\bscope:\s*\{/u), marker("tag: '", /\btag:\s*['"]/u), marker("storageName:", /\bstorageName:/u),
  ],
  marionette: [
    marker("Mn.", /\bMn\.\w+/u), marker("ui: {", /\bui:\s*\{/u), marker("@ui.", /@ui\.\w+/u), marker("this.ui.", /\bthis\.ui\.\w+/u),
    marker("modelEvents:", /\b(?:model|collection)Events\s*:/u), marker("childView", /\bchildView(?:Container|Options)?\s*:/u),
    marker("regions:", /\bregions\s*:/u), marker("showChildView(", /\bshowChildView\(/u), marker("Radio.channel(", /\bRadio\.channel\(/u),
    marker("onRender", /\bon(?:Render|Attach|Show|BeforeRender|DomRefresh)\s*:/u), marker("templateContext", /\btemplateContext\s*:/u),
  ],
});

export const isKnownFramework = (id: string): boolean => Object.hasOwn(FRAMEWORK_MARKERS, id);

/** The markers of `framework` a window shows, most telling first. */
export const shownMarkers = (code: string, framework: string): readonly FrameworkMarker[] =>
  FRAMEWORK_MARKERS[framework]!.filter(({ pattern }) => pattern.test(code));

/**
 * What a hint quotes for a marker the code shows: the code it matched, trimmed to its first line, so a player finds
 * exactly that (`@change="`, where the marker is any event binding); or the marker's prose, which quotes for itself.
 */
export const markerQuote = (code: string, marker: FrameworkMarker): string =>
  marker.shown.includes("`") ? marker.shown : marker.pattern.exec(code)![0].trim().split("\n")[0]!.trim();

/** The fewest of its own framework's markers a window shows; one alone may be a coincidence. */
export const MINIMUM_MARKERS = 2;

/**
 * Whether a window tells `framework` apart from the rest of its family: it shows at least `MINIMUM_MARKERS` of its own
 * markers, and no marker of another member, which that member's reader would take for their own.
 */
export const tellsFrameworkApart = (code: string, framework: string, family: readonly string[]): boolean =>
  shownMarkers(code, framework).length >= MINIMUM_MARKERS
  && family.every((other) => other === framework || shownMarkers(code, other).length === 0);
