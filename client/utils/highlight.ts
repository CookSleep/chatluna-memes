/** 滚动到从其他页面跳转过来的目标，并让 highlight 元素闪一下底色。 */
export function scrollAndFlash(target: HTMLElement, highlight: HTMLElement, block: ScrollLogicalPosition) {
  target.scrollIntoView({ behavior: 'smooth', block })
  highlight.classList.remove('is-highlight')
  void highlight.offsetWidth
  highlight.classList.add('is-highlight')
  setTimeout(() => highlight.classList.remove('is-highlight'), 2000)
}
