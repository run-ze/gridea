import { beginRules, inlineRules } from './rules'
import { isLengthEven, union } from '../utils'
import { getAttributes, parseSrcAndTitle, validateEmphasize, lowerPriority } from './utils'

// const CAN_NEST_RULES = ['strong', 'em', 'link', 'del', 'a_link', 'reference_link', 'html_tag']
// disallowed html tags in https://github.github.com/gfm/#raw-html
const disallowedHtmlTag = /(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)/i
const validateRules = Object.assign({}, inlineRules)
delete validateRules.em
delete validateRules.strong
delete validateRules['tail_header']
delete validateRules['backlash']

const tokenizerFac = (src, beginRules, inlineRules, pos = 0, top, labels) => {
  const tokens = []
  let pending = ''
  let pendingStartPos = pos

  const pushPending = () => {
    if (pending) {
      tokens.push({
        type: 'text',
        raw: pending,
        content: pending,
        range: {
          start: pendingStartPos,
          end: pos
        }
      })
    }

    pendingStartPos = pos
    pending = ''
  }

  if (beginRules && pos === 0) {
    const beginRuleList = ['header', 'hr', 'code_fense', 'multiple_math']

    for (const ruleName of beginRuleList) {
      const to = beginRules[ruleName].exec(src)

      if (to) {
        const token = {
          type: ruleName,
          raw: to[0],
          parent: tokens,
          marker: to[1],
          content: to[2] || '',
          backlash: to[3] || '',
          range: {
            start: pos,
            end: pos + to[0].length
          }
        }
        tokens.push(token)
        src = src.substring(to[0].length)
        pos = pos + to[0].length
        break
      }
    }
    const def = beginRules['reference_definition'].exec(src)
    if (def && isLengthEven(def[3])) {
      const token = {
        type: 'reference_definition',
        parent: tokens,
        leftBracket: def[1],
        label: def[2],
        backlash: def[3] || '',
        rightBracket: def[4],
        leftHrefMarker: def[5] || '',
        href: def[6],
        rightHrefMarker: def[7] || '',
        leftTitlespace: def[8],
        titleMarker: def[9] || '',
        title: def[10] || '',
        rightTitleSpace: def[11] || '',
        raw: def[0],
        range: {
          start: pos,
          end: pos + def[0].length
        }
      }
      tokens.push(token)
      src = src.substring(def[0].length)
      pos = pos + def[0].length
    }
  }

  while (src.length) {
    // backlash
    const backTo = inlineRules.backlash.exec(src)
    if (backTo) {
      pushPending()
      tokens.push({
        type: 'backlash',
        raw: backTo[1],
        marker: backTo[1],
        parent: tokens,
        content: '',
        range: {
          start: pos,
          end: pos + backTo[1].length
        }
      })
      pending += pending + backTo[2]
      pendingStartPos = pos + backTo[1].length
      src = src.substring(backTo[0].length)
      pos = pos + backTo[0].length
      continue
    }
    // strong | em
    const emRules = ['strong', 'em']
    let inChunk
    for (const rule of emRules) {
      const to = inlineRules[rule].exec(src)
      if (to && isLengthEven(to[3])) {
        const isValid = validateEmphasize(src, to[0].length, to[1], pending, validateRules)
        if (isValid) {
          inChunk = true
          pushPending()
          const range = {
            start: pos,
            end: pos + to[0].length
          }
          const marker = to[1]
          tokens.push({
            type: rule,
            raw: to[0],
            range,
            marker,
            parent: tokens,
            children: tokenizerFac(to[2], undefined, inlineRules, pos + to[1].length, false, labels),
            backlash: to[3]
          })
          src = src.substring(to[0].length)
          pos = pos + to[0].length
        }
        break
      }
    }
    if (inChunk) continue

    // strong | em | emoji | inline_code | del | inline_math
    const chunks = ['inline_code', 'del', 'emoji', 'inline_math']
    for (const rule of chunks) {
      const to = inlineRules[rule].exec(src)
      if (to && isLengthEven(to[3])) {
        if (rule === 'emoji' && !lowerPriority(src, to[0].length, validateRules)) break
        inChunk = true
        pushPending()
        const range = {
          start: pos,
          end: pos + to[0].length
        }
        const marker = to[1]
        if (rule === 'inline_code' || rule === 'emoji' || rule === 'inline_math') {
          tokens.push({
            type: rule,
            raw: to[0],
            range,
            marker,
            parent: tokens,
            content: to[2],
            backlash: to[3]
          })
        } else {
          tokens.push({
            type: rule,
            raw: to[0],
            range,
            marker,
            parent: tokens,
            children: tokenizerFac(to[2], undefined, inlineRules, pos + to[1].length, false, labels),
            backlash: to[3]
          })
        }
        src = src.substring(to[0].length)
        pos = pos + to[0].length
        break
      }
    }
    if (inChunk) continue
    // image
    const imageTo = inlineRules.image.exec(src)
    if (imageTo && isLengthEven(imageTo[3]) && isLengthEven(imageTo[5])) {
      const { src: imageSrc, title } = parseSrcAndTitle(imageTo[4])
      pushPending()
      tokens.push({
        type: 'image',
        raw: imageTo[0],
        marker: imageTo[1],
        srcAndTitle: imageTo[4],
        src: imageSrc,
        title,
        parent: tokens,
        range: {
          start: pos,
          end: pos + imageTo[0].length
        },
        alt: imageTo[2],
        backlash: {
          first: imageTo[3],
          second: imageTo[5]
        }
      })
      src = src.substring(imageTo[0].length)
      pos = pos + imageTo[0].length
      continue
    }
    // link
    const linkTo = inlineRules.link.exec(src)
    if (linkTo && isLengthEven(linkTo[3]) && isLengthEven(linkTo[5])) {
      const { src: href, title } = parseSrcAndTitle(linkTo[4])
      pushPending()
      tokens.push({
        type: 'link',
        raw: linkTo[0],
        marker: linkTo[1],
        hrefAndTitle: linkTo[4],
        href,
        title,
        parent: tokens,
        anchor: linkTo[2],
        range: {
          start: pos,
          end: pos + linkTo[0].length
        },
        children: tokenizerFac(linkTo[2], undefined, inlineRules, pos + linkTo[1].length, false, labels),
        backlash: {
          first: linkTo[3],
          second: linkTo[5]
        }
      })

      src = src.substring(linkTo[0].length)
      pos = pos + linkTo[0].length
      continue
    }

    const rLinkTo = inlineRules['reference_link'].exec(src)
    if (rLinkTo && labels.has(rLinkTo[3] || rLinkTo[1]) && isLengthEven(rLinkTo[2]) && isLengthEven(rLinkTo[4])) {
      pushPending()
      tokens.push({
        type: 'reference_link',
        raw: rLinkTo[0],
        isFullLink: !!rLinkTo[3],
        parent: tokens,
        anchor: rLinkTo[1],
        backlash: {
          first: rLinkTo[2],
          second: rLinkTo[4] || ''
        },
        label: rLinkTo[3] || rLinkTo[1],
        range: {
          start: pos,
          end: pos + rLinkTo[0].length
        },
        children: tokenizerFac(rLinkTo[1], undefined, inlineRules, pos + 1, false, labels)
      })

      src = src.substring(rLinkTo[0].length)
      pos = pos + rLinkTo[0].length
      continue
    }

    const rImageTo = inlineRules['reference_image'].exec(src)
    if (rImageTo && labels.has(rImageTo[3] || rImageTo[1]) && isLengthEven(rImageTo[2]) && isLengthEven(rImageTo[4])) {
      pushPending()

      tokens.push({
        type: 'reference_image',
        raw: rImageTo[0],
        isFullLink: !!rImageTo[3],
        parent: tokens,
        alt: rImageTo[1],
        backlash: {
          first: rImageTo[2],
          second: rImageTo[4] || ''
        },
        label: rImageTo[3] || rImageTo[1],
        range: {
          start: pos,
          end: pos + rImageTo[0].length
        }
      })

      src = src.substring(rImageTo[0].length)
      pos = pos + rImageTo[0].length
      continue
    }

    // html escape
    const htmlEscapeTo = inlineRules['html_escape'].exec(src)
    if (htmlEscapeTo) {
      const len = htmlEscapeTo[0].length
      pushPending()
      tokens.push({
        type: 'html_escape',
        raw: htmlEscapeTo[0],
        escapeCharacter: htmlEscapeTo[1],
        parent: tokens,
        range: {
          start: pos,
          end: pos + len
        }
      })
      src = src.substring(len)
      pos = pos + len
      continue
    }

    // html-tag
    const htmlTo = inlineRules['html_tag'].exec(src)
    let attrs
    // handle comment
    if (htmlTo && htmlTo[1] && !htmlTo[3]) {
      const len = htmlTo[0].length
      pushPending()
      tokens.push({
        type: 'html_tag',
        raw: htmlTo[0],
        tag: '<!---->',
        openTag: htmlTo[1],
        parent: tokens,
        attrs: {},
        range: {
          start: pos,
          end: pos + len
        }
      })
      src = src.substring(len)
      pos = pos + len
      continue
    }
    if (htmlTo && !(disallowedHtmlTag.test(htmlTo[3])) && (attrs = getAttributes(htmlTo[0]))) {
      const tag = htmlTo[3]
      const html = htmlTo[0]
      const len = htmlTo[0].length

      pushPending()
      tokens.push({
        type: 'html_tag',
        raw: html,
        tag,
        openTag: htmlTo[2],
        closeTag: htmlTo[5],
        parent: tokens,
        attrs,
        content: htmlTo[4],
        children: htmlTo[4] ? tokenizerFac(htmlTo[4], undefined, inlineRules, pos + htmlTo[2].length, false, labels) : '',
        range: {
          start: pos,
          end: pos + len
        }
      })
      src = src.substring(len)
      pos = pos + len
      continue
    }

    // auto link
    const autoLTo = inlineRules['auto_link'].exec(src)
    if (autoLTo) {
      pushPending()
      tokens.push({
        type: 'auto_link',
        raw: autoLTo[0],
        href: autoLTo[0],
        parent: tokens,
        range: {
          start: pos,
          end: pos + autoLTo[0].length
        }
      })
      src = src.substring(autoLTo[0].length)
      pos = pos + autoLTo[0].length
      continue
    }
    // soft line break
    const softTo = inlineRules['soft_line_break'].exec(src)
    if (softTo) {
      const len = softTo[0].length
      pushPending()
      tokens.push({
        type: 'soft_line_break',
        raw: softTo[0],
        lineBreak: softTo[1],
        isAtEnd: softTo.input.length === softTo[0].length,
        parent: tokens,
        range: {
          start: pos,
          end: pos + len
        }
      })
      src = src.substring(len)
      pos += len
      continue
    }
    // hard line break
    const hardTo = inlineRules['hard_line_break'].exec(src)
    if (hardTo) {
      const len = hardTo[0].length
      pushPending()
      tokens.push({
        type: 'hard_line_break',
        raw: hardTo[0],
        spaces: hardTo[1],
        lineBreak: hardTo[2],
        isAtEnd: hardTo.input.length === hardTo[0].length,
        parent: tokens,
        range: {
          start: pos,
          end: pos + len
        }
      })
      src = src.substring(len)
      pos += len
      continue
    }

    // tail header
    const tailTo = inlineRules['tail_header'].exec(src)
    if (tailTo && top) {
      pushPending()
      tokens.push({
        type: 'tail_header',
        raw: tailTo[1],
        marker: tailTo[1],
        parent: tokens,
        range: {
          start: pos,
          end: pos + tailTo[1].length
        }
      })
      src = src.substring(tailTo[1].length)
      pos += tailTo[1].length
      continue
    }

    if (!pending) pendingStartPos = pos
    pending += src[0]
    src = src.substring(1)
    pos++
  }

  pushPending()
  return tokens
}

export const tokenizer = (src, highlights = [], hasBeginRules = true, labels = new Map()) => {
  const tokens = tokenizerFac(src, hasBeginRules ? beginRules : null, inlineRules, 0, true, labels)

  const postTokenizer = tokens => {
    for (const token of tokens) {
      for (const light of highlights) {
        const highlight = union(token.range, light)
        if (highlight) {
          if (token.highlights && Array.isArray(token.highlights)) {
            token.highlights.push(highlight)
          } else {
            token.highlights = [highlight]
          }
        }
      }
      if (token.children && Array.isArray(token.children)) {
        postTokenizer(token.children)
      }
    }
  }
  if (highlights.length) {
    postTokenizer(tokens)
  }

  return tokens
}

// transform `tokens` to text ignore the range of token
// the opposite of tokenizer
export const generator = tokens => {
  let result = ''
  for (const token of tokens) {
    result += token.raw
  }
  return result
}
