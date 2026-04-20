import { createCategoryLoader } from "../../../.vitepress/data/category-loader";
import type { CategoryPostMeta } from "../../../.vitepress/data/category-loader";
import type { ContentLoader } from "../../../.vitepress/data/content-loader";

const postsData: ContentLoader<CategoryPostMeta[]> = createCategoryLoader("en/posts/junk/*.md", "/en/posts/junk/");

declare const data: CategoryPostMeta[];
export { data };
export default postsData;
