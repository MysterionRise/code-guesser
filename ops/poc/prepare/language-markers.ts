import { LANGUAGE_PAIRS, type StackLanguage } from "../../../packages/artifact/src/index";

/**
 * Syntax that tells a language apart from its look-alike. Every language round offers its answer and that
 * look-alike, so a round is fair only when its code shows at least one of these markers. `shown` is what the
 * syntax hint quotes; markers come most telling first.
 */
export interface Marker {
  readonly shown: string;
  readonly pattern: RegExp;
}

const marker = (shown: string, pattern: RegExp): Marker => Object.freeze({ shown, pattern });

export const MARKERS: Readonly<Record<StackLanguage, readonly Marker[]>> = Object.freeze({
  Python: [
    marker("elif", /\belif\b/u), marker("None", /\bNone\b/u), marker("True", /\bTrue\b/u), marker("False", /\bFalse\b/u),
    marker("(self", /\(\s*self\s*[,)]/u), marker("__init__", /\b__\w+__\b/u), marker("pass", /^\s*pass\s*$/mu),
    marker("not in", /\bnot\s+in\b/u), marker("is not", /\bis\s+not\b/u), marker("f\"", /\bf["']/u),
    marker("len(", /\blen\(/u), marker("range(", /\brange\(/u), marker("with", /^\s*(?:async\s+)?with\s.+:\s*$/mu),
  ],
  Ruby: [
    marker("elsif", /\belsif\b/u), marker("end", /^\s*end\s*$/mu), marker("nil", /\bnil\b/u), marker("do |", /\bdo\s*\|/u),
    marker("attr_reader", /\battr_reader\b/u), marker("attr_accessor", /\battr_accessor\b/u), marker("unless", /\bunless\b/u),
    marker("puts", /\bputs\b/u), marker("=>", /=>/u), marker("||=", /\|\|=/u), marker("#{", /#\{/u),
    marker("module", /^\s*module\s+[A-Z]/mu), marker("rescue", /\brescue\b/u), marker("&.", /\w&\.\w/u),
  ],
  TypeScript: [
    marker("interface", /\binterface\s+[A-Z]\w*/u), marker("type", /^\s*(?:export\s+)?type\s+[A-Z]\w*(?:<[^>]*>)?\s*=/mu),
    marker(": string", /:\s*string\b/u), marker(": number", /:\s*number\b/u), marker(": boolean", /:\s*boolean\b/u),
    marker(": void", /\)\s*:\s*void\b/u), marker(": any", /:\s*any\b/u), marker(": unknown", /:\s*unknown\b/u),
    marker("readonly", /\breadonly\s+\w/u), marker("private", /\bprivate\s+(?:readonly\s+)?\w+\s*[:(=;?]/u),
    marker("protected", /\bprotected\s+(?:readonly\s+)?\w+\s*[:(=;?]/u), marker("public", /\bpublic\s+(?:readonly\s+)?\w+\s*[:(=;?]/u),
    marker("implements", /\bimplements\s+[A-Z]/u), marker("enum", /\benum\s+[A-Z]\w*\s*\{/u), marker("as const", /\bas\s+const\b/u),
    marker("?:", /\w\?:\s*\w/u), marker("declare", /^\s*declare\s/mu), marker(": Promise<", /:\s*Promise</u),
  ],
  JavaScript: [
    marker("require(", /\brequire\(/u), marker("module.exports", /\bmodule\.exports\b/u), marker("exports.", /^\s*exports\.\w+\s*=/mu),
    marker(".prototype.", /\.prototype\.\w+\s*=/u), marker("@param {", /@param\s+\{/u), marker("PropTypes", /\bPropTypes\b/u),
    marker("var", /^\s*var\s+\w/mu),
    marker("untyped `function` parameters", /\bfunction\s*[\w$]*\s*\(\s*[A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)+\s*\)\s*\{/u),
  ],
  Go: [
    marker(":=", /:=/u), marker("err != nil", /\berr\s*!=\s*nil\b/u), marker("nil", /\bnil\b/u), marker("defer", /\bdefer\b/u),
    marker("chan", /\bchan\b/u), marker("go func", /\bgo\s+func\b/u), marker("func", /\bfunc\b/u), marker("fmt.", /\bfmt\.\w/u),
  ],
  Rust: [
    marker("fn", /\bfn\s+\w/u), marker("let", /\blet\s+(?:mut\s+)?\w/u), marker("impl", /\bimpl\b/u), marker("&self", /&(?:mut\s+)?self\b/u),
    marker("::", /::/u), marker("->", /->/u), marker("match", /\bmatch\s+[^{\n]+\{/u), marker("Some(", /\bSome\(/u),
    marker("Ok(", /\bOk\(/u), marker("Err(", /\bErr\(/u), marker("mut", /\bmut\b/u), marker("#[", /#\[/u),
    marker("`!` macros", /\b[a-z_]+!\s*[([{]/u),
  ],
  Java: [
    marker("boolean", /\bboolean\b/u), marker("extends", /\bextends\s+[A-Z]/u), marker("implements", /\bimplements\s+[A-Z]/u),
    marker("@Override", /@Override\b/u), marker("final", /\bfinal\s/u), marker("throws", /\)\s*throws\s+[A-Z]/u),
    marker("System.out", /\bSystem\.out\b/u), marker("instanceof", /\binstanceof\b/u), marker(".equals(", /\.equals\(/u),
    marker("->", /->/u), marker(".length", /\.length\b/u), marker(".size()", /\.size\(\)/u), marker("String[]", /\bString\[\]/u),
    marker("`@` annotations", /^\s*@[A-Z]\w*/mu),
  ],
  "C#": [
    marker("{ get;", /\{\s*get\s*[;{=]/u), marker("bool", /\bbool\b/u), marker("string", /\bstring\s+[A-Za-z_]\w*\s*[=;,)]/u),
    marker("=>", /=>/u), marker("override", /\boverride\s/u), marker("foreach", /\bforeach\s*\(/u), marker("namespace", /\bnamespace\s+\w/u),
    marker("readonly", /\breadonly\s/u), marker("internal", /\binternal\s/u), marker("async Task", /\basync\s+Task\b/u),
    marker("Console.", /\bConsole\.\w/u), marker("??", /\?\?/u), marker("$\"", /\$"/u),
    marker(".Length", /\.Length\b/u), marker(".Count", /\.Count\b/u), marker("nameof(", /\bnameof\(/u),
    marker("using (", /\busing\s*\(/u), marker("`[…]` attributes", /^\s*\[[A-Z]\w*(?:\(.*\))?\]\s*$/mu),
  ],
  Kotlin: [
    marker("fun", /\bfun\s+(?:<[^>]+>\s*)?[\w.]+\s*\(/u), marker("val", /\bval\s+\w/u), marker("when", /\bwhen\s*(?:\([^)]*\))?\s*\{/u),
    marker("data class", /\bdata\s+class\b/u), marker("object", /^\s*(?:companion\s+)?object\b/mu), marker("!!", /!!/u),
    marker("null", /\bnull\b/u), marker("?:", /\?:/u), marker("${", /\$\{/u), marker("it.", /\bit\./u), marker("suspend", /\bsuspend\s/u),
    marker("lateinit", /\blateinit\b/u), marker(": Unit", /:\s*Unit\b/u), marker("println(", /\bprintln\(/u),
    marker("listOf(", /\b(?:listOf|mapOf|setOf|mutableListOf|mutableMapOf|emptyList)\(/u), marker("::class", /::class\b/u),
    marker("init {", /\binit\s*\{/u),
  ],
  Swift: [
    marker("func", /\bfunc\s+\w/u), marker("let", /(?:^|[^.\w])let\s+\w+\s*[:=]/mu), marker("guard", /\bguard\s/u), marker("nil", /\bnil\b/u),
    marker("if let", /\bif\s+let\b/u), marker("\\(", /\\\(/u), marker("struct", /\bstruct\s+[A-Z]/u), marker("protocol", /\bprotocol\s+[A-Z]/u),
    marker("extension", /^\s*(?:public\s+|private\s+|fileprivate\s+)?extension\s+[A-Z]/mu), marker("init(", /\binit\(/u),
    marker("self.", /\bself\./u), marker("??", /\?\?/u), marker("case", /^\s*case\s/mu), marker("switch", /\bswitch\s/u),
    marker("mutating", /\bmutating\s/u), marker("[weak self]", /\[weak\s+self\]/u), marker("@objc", /@objc\b/u),
    marker("@State", /@State\b/u), marker("@escaping", /@escaping\b/u),
  ],
  C: [
    marker("malloc(", /\bmalloc\(/u), marker("free(", /\bfree\(/u), marker("typedef struct", /\btypedef\s+struct\b/u),
    marker("printf(", /\b(?:f|s|sn)?printf\(/u), marker("NULL", /\bNULL\b/u), marker("struct … *", /\bstruct\s+\w+\s*\*/u),
    marker("(void)", /\(\s*void\s*\)/u), marker("->", /->/u),
  ],
  "C++": [
    marker("::", /::/u), marker("template", /\btemplate\s*</u), marker("nullptr", /\bnullptr\b/u), marker("namespace", /\bnamespace\b/u),
    marker("class", /\bclass\s+\w+\s*(?:final\s*)?[:{]/u), marker("auto", /\bauto\s+[\w&*[]/u), marker("public:", /^\s*(?:public|private|protected):/mu),
    marker("this->", /\bthis->/u), marker("new", /\bnew\s+[A-Za-z_]\w*/u), marker("override", /\boverride\b/u), marker("virtual", /\bvirtual\b/u),
    marker("const &", /\bconst\s+[\w:<>]+\s*&/u),
  ],
});

/**
 * A language that builds on its look-alike: a C++ file may hold C idioms and a TypeScript file JavaScript ones,
 * so a superset language's round needs its own syntax only. Its subset's rounds must show none of the
 * superset's syntax, or the code would read as either.
 */
const SUPERSETS: ReadonlySet<StackLanguage> = new Set(["C++", "TypeScript"]);

/** What a language's look-alike shares with it, for the reveal. */
const LOOKALIKE_NOTES: ReadonlyMap<string, string> = new Map([
  ["Python|Ruby", "both use def, # comments, and no braces"],
  ["TypeScript|JavaScript", "TypeScript is JavaScript with types added"],
  ["Go|Rust", "both wrap blocks in braces and give structs their own methods"],
  ["Java|C#", "both put methods in classes behind the same access modifiers"],
  ["Kotlin|Swift", "both declare with var and mark a type that may be missing with ?"],
  ["C|C++", "C++ grew out of C and compiles most C code"],
]);

const pairOf = (language: StackLanguage): readonly [StackLanguage, StackLanguage] =>
  LANGUAGE_PAIRS.find((pair) => pair.includes(language))!;

export const lookalikeOf = (language: StackLanguage): StackLanguage => pairOf(language).find((member) => member !== language)!;

/** The first of a language's markers the code shows, if any. */
export const firstMarker = (code: string, language: StackLanguage): Marker | undefined =>
  MARKERS[language].find(({ pattern }) => pattern.test(code));

/**
 * Whether code tells its language apart from the look-alike: it shows the language's own syntax and, unless
 * the language builds on the look-alike, none of the look-alike's.
 */
export const tellsApart = (code: string, language: StackLanguage): boolean =>
  firstMarker(code, language) !== undefined
  && (SUPERSETS.has(language) || firstMarker(code, lookalikeOf(language)) === undefined);

/** What the reveal says: the syntax that settles it, and why the look-alike was tempting. */
export const markerSignals = (code: string, language: StackLanguage): Readonly<{ helpful: string; misleading: string }> => {
  const found = firstMarker(code, language)!;
  const lookalike = lookalikeOf(language);
  const shown = found.shown.includes("`") ? found.shown : `\`${found.shown}\``;
  const helpful = SUPERSETS.has(lookalike)
    ? `${shown} is typical ${language}, and nothing here needs ${lookalike}.`
    : `${shown} is typical ${language}, not ${lookalike}.`;
  const note = LOOKALIKE_NOTES.get(pairOf(language).join("|"))!;
  return Object.freeze({ helpful, misleading: `${lookalike} looks much the same: ${note}.` });
};
