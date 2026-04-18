export interface ContentLoader<T> {
  watch: string[];
  load: () => Promise<T[]>;
}
