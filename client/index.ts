import { icons } from '@koishijs/client'
import { h } from 'vue'
import Dashboard from './Dashboard.vue'

// 右下角卷起的表情包贴纸。
const ChatLunaMemesIcon = {
  name: 'ChatLunaMemesIcon',
  render() {
    return h(
      'svg',
      {
        class: 'k-icon',
        viewBox: '0 0 24 24',
        xmlns: 'http://www.w3.org/2000/svg',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.75,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      [
        // 轮廓、卷边和嘴合成一条路径：未选中时图标半透明，分开画的话交叠处会发深。
        h('path', { d: 'M13 20.5H7.5a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4V13ZM20.5 13H17a4 4 0 0 0-4 4v3.5M8.5 13.5c1.6 1.6 4.4 1.6 6 0' }),
        // 眼睛用零长度线段加圆头画成实心圆点，同样避免填充和描边叠色。
        h('path', { d: 'M9 9.5h0M15 9.5h0', 'stroke-width': 2.95 }),
      ]
    )
  },
}

icons.register('ChatLunaMemesEmoji', ChatLunaMemesIcon)

export default (ctx: any) => {
  ctx.page({
    name: 'ChatLuna Memes',
    path: '/chatluna-memes',
    icon: 'ChatLunaMemesEmoji',
    component: Dashboard,
    authority: 1,
    order: 500,
  })
}
