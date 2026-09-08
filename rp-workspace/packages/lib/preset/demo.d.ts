/**
 * 两个示范预设（M1 / T1.10，计划文档 §3.2 三条生成路径的前两条走查载体）
 *
 * - demo-direct：直答型（场景 A）——无工具预算、单次调用直出
 * - demo-light-agent：轻 agent 型（场景 B）——小工具面（lore_query 深查），软预算 2 轮封顶
 */
import { type RPPreset } from './schema.ts';
/** 直答型示范预设（场景 A 走查载体） */
export declare function demoDirectPreset(): RPPreset;
/** 轻 agent 型示范预设（场景 B 走查载体：lore_query 深查） */
export declare function demoLightAgentPreset(): RPPreset;
