import { sys, CompletionEntryDetails } from "typescript"
import { langService, doctmp, findMark, updateDocTmp } from "./base"
import { getPropDescription, getComponentLink } from "./utils";

interface OptionItem {
  ac: CompletionEntryDetails,

  name: string,
  provider: string, // "addon/foobar"
  providerFile: string, // full file path to addon/foobar
  providerDesc: string, // addon description in one line
  optional: boolean,
  description: string,
  type: string,

  /** If Accept a Partial<Object>, this stores all possible members */
  objProp?: Record<string, {
    description: string,
    type: string,
    default: string,
  }>,
}

export function make(): string {
  const output: string[] = []
  const options: OptionItem[] = []

  /** emulate auto-completition to get all acceptable options */

  updateDocTmp(`
  var c: HyperMD.EditorConfiguration = {
    /*1*/
  }
  `)

  var markPos = findMark("1")
  langService.getCompletionsAtPosition(doctmp, markPos, {
    includeExternalModuleExports: true,
    includeInsertTextCompletions: false,
  }).entries.forEach(it => {
    if (it.kind !== "property") return

    const { name } = it

    var ac = langService.getCompletionEntryDetails(doctmp, markPos, name, {}, undefined, undefined)

    var type = ac.displayParts.map(x => x.text).join("").replace(/^.+?\:\s*/, '')

    var oi: OptionItem = {
      ac,
      name,
      provider: null,
      providerFile: null,
      providerDesc: "",
      type,
      description: null,
      optional: it.kindModifiers.includes("optional"),
      objProp: /Partial\<.+\>/.test(type) ? {} : null,
    }

    options.push(oi)
  })

  /** for each OptionItem, retrive its detail info! */

  options.forEach(opt => {
    const { name, objProp } = opt

    updateDocTmp(`
    var c: HyperMD.EditorConfiguration = {
      /*2*/${name}: { /*3*/ }
    }
    `)

    var def = langService.getDefinitionAtPosition(doctmp, findMark('2') + 6)
    var providerFile = def[0].fileName // addon's filename
    var providerCode = sys.readFile(providerFile) // addon's source code!

    opt.provider = providerFile.match(/src\/(.+)\.ts$/)[1]
    opt.providerFile = providerFile
    opt.providerDesc = providerCode.match(/^(?:\/\/|\s*\*)?\s+DESCRIPTION:\s*(.+)$/m)[1]
    opt.description = getPropDescription(opt.ac, providerFile)

    if (objProp) {
      // this option may accept a object
      // find out what does it support

      let markPos = findMark('3')

      // Find defaultOption declarations
      let defaultValues = {}
      {
        // extract {...}
        let defSince = providerCode.match(/^.+defaultOption(?:\s*\:\s*\w+)\s*=\s*\{/m)
        if (defSince) {
          let t = providerCode.slice(defSince.index + defSince[0].length)

          t.slice(0, t.match(/^\s*\}/m).index) // get content inside { ... }
            .trim()
            .split("\n")
            .forEach(x => {
              var tmp = x.match(/^\s*(\S+)\s*\:\s*(.+)$/)
              if (!tmp) return;
              defaultValues[tmp[1]] = tmp[2].replace(/^\s+|\s*(?:\,\s*)?(?:\/\/.*)?$|\s+$/g, '');
            })
        }
      }

      // check what Partial<Options> accepts
      langService.getCompletionsAtPosition(doctmp, markPos, {
        includeExternalModuleExports: true,
        includeInsertTextCompletions: false,
      }).entries.forEach(it => {

        if (it.kind !== "property") return
        const { name } = it

        var ac = langService.getCompletionEntryDetails(doctmp, markPos, name, {}, undefined, undefined)

        var type = ac.displayParts.map(x => x.text).join("").replace(/^.+?\:\s*/, '')
        var description = getPropDescription(ac, providerFile)
        var defaultVal = "undefined"

        objProp[name] = {
          description,
          type,
          default: defaultValues[name] || "undefined",
        }
      })
    }
  })

  output.push(`# HyperMD Configurations

> This documentation is automatically generated by *dev/docgen/configurations.md.ts* from addons' source files

| Name | Addon | Addon Description |
| ---- | ---- | ---- |
${options.map(x => `| ${x.name} | ${getComponentLink(x.provider)} | ${x.providerDesc} |`).join("\n")}

`)


  options.forEach(opt => {
    output.push(`
## ${opt.name}

⭐ ***Provided by ${getComponentLink(opt.provider)}*** ( ${opt.providerDesc} )
⭐ ***Accepted Types***: \`${opt.type.replace(/Partial\<\w+\>/g, 'object')}\`

${opt.description}

`)

    if (opt.objProp) {
      var multiLineDescriptions = "" // maybe some prop's description span lines

      output.push(`| Name | Type | Description |
| ---- | ---- | ----------- |`)
      for (const key in opt.objProp) {
        let description = opt.objProp[key].description.replace(/^\s*\@\w+/gm, '***$1*** ')
        if (description.includes("\n")) {
          multiLineDescriptions += [
            `### ${opt.name}.${key}`,
            description,
            "",
          ].join("\n\n")
          description = "(See Below)"
        }
        output.push(`| ${key} | \`${opt.objProp[key].type.replace(/\n\s*/g, ' ')}\` | ${description} |`)
      }

      if (multiLineDescriptions) {
        output.push("\n")
        output.push(multiLineDescriptions)
      }

      output.push("\n\n")
    }
  })

  return output.join("\n")
}
