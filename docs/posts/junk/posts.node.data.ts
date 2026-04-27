import { createCategoryLoader } from "../../.vitepress/data/category-loader.ts";
import type { CategoryPostMeta } from "../../.vitepress/data/category-loader.ts";
import type { ContentLoader } from "../../.vitepress/data/content-loader.ts";

const postsData: ContentLoader<CategoryPostMeta[]> = createCategoryLoader("posts/junk/*.md", "/posts/junk/");

declare const data: CategoryPostMeta[];
export { data };
export default postsData;
