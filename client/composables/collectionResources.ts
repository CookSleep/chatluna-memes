import type { CollectionResourcePage, CollectionPageQuery } from '../../src/console-rpc'

/** 丢弃较早请求的结果，包括切换前的表情包、旧搜索和已退出页面的请求。 */
export class CollectionPageLoader {
  private generation = 0

  constructor(private fetchPage: (name: string, query: CollectionPageQuery) => Promise<CollectionResourcePage>) {}

  invalidate() { this.generation++ }

  async load(name: string, query: CollectionPageQuery): Promise<CollectionResourcePage | null> {
    const current = ++this.generation
    try {
      const result = await this.fetchPage(name, query)
      return current === this.generation ? result : null
    } catch (error) {
      if (current === this.generation) throw error
      return null
    }
  }
}
