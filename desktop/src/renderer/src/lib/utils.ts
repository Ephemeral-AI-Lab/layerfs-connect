// `cn` that knows the theme's own size names (styles/globals.css): without
// them it treats text-md, text-15, rounded-md-plus or font-strong as colours
// or drops them when a later class looks like the same group.
import { createCn } from 'cn/config'

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        { text: ['3xs', '2xs', 'xs-plus', 'sm-plus', 'md', 'md-plus', 'base-plus', 'lg-plus', '10', '11', '12', '13', '14', '15', '16', '18', '20', '24', '28'] },
      ],
      rounded: [{ rounded: ['3xs', '2xs', 'md-plus', 'lg-plus', 'round'] }],
      'font-weight': [{ font: ['medium-plus', 'strong'] }],
      leading: [{ leading: ['heading', 'tighter', 'compact', 'compact-plus', 'body', 'chat', 'prose', 'row'] }],
    },
  },
})
