# Conan Designer Schema 组件协议

本协议来自 `conan-oversea-designer` 提交 `2876f0d26503318af3d95d7bc9fb1706d6555377`。主要来源：

- `src/pages/enhancedConfig/widgets/formRender/newFormRender.tsx`：运行时注册组件。
- `src/pages/playground/utils/convertFormRenderToFormily.ts`：类型到组件的标准映射。
- `src/pages/playground/utils/json2schemaNew.ts`：从配置 JSON 生成 Schema 的结构。
- `src/components/*/preview.tsx`：设计器资源模板。

## 目录

- [根结构](#根结构)
- [值类型映射](#值类型映射)
- [简单列表](#简单列表)
- [对象列表](#对象列表)
- [项目组件](#项目组件)
- [允许的组件](#允许的组件)
- [生成规则](#生成规则)

## 根结构

新 Schema 使用 `type=2`，`schemaJson` 必须是：

```json
{
  "form": {
    "labelCol": 6,
    "wrapperCol": 12
  },
  "schema": {
    "type": "object",
    "properties": {}
  }
}
```

将配置对象的每个 key 放在 `schema.properties` 下。普通值字段默认使用 `x-decorator: "FormItem"`。`x-designable-id` 仅供设计器标识，创建时可以省略。

## 值类型映射

| 配置值 | `type` | `x-component` | 关键约束 |
| --- | --- | --- | --- |
| 单行字符串 | `string` | `Input` | 默认选择 |
| 多行字符串 | `string` | `Input.TextArea` | 文案、JSON 片段等长文本 |
| 数字 | `number` | `NumberPicker` | 不要用字符串 Input 代替 |
| 布尔值 | `boolean` | `Switch` | 无默认值时使用 `default: false` |
| 单选枚举 | 原值类型 | `Select` / `Radio.Group` | `enum` 使用 `{label,value}` |
| 多选枚举 | `array` | `Select` | `x-component-props.mode: "multiple"` |
| 日期字符串 | `string` | `DatePicker` | 日期范围使用 `DatePicker.RangePicker` |
| 普通对象 | `object` | `Card` | 子字段放入 `properties` |
| 字符串列表 | `array` | `ArrayItemsSimple` | 内部组件用 `Input.TextArea` |
| 数字列表 | `array` | `ArrayNumbers` | 内部组件用 `NumberPicker` |
| 对象列表 | `array` | `ArrayCollapse` | 必须包含 `items`、面板和增删操作 |
| 大型对象列表 | `array` | `ArrayPagination` | 与 `ArrayCollapse` 同构；运行时固定每页 10 条 |
| 单文件 URL | `string` | `Upload` | 组件值是 URL 字符串 |
| 多文件 URL | `array` | `UploadMulti` | 组件值是 URL 字符串数组 |
| Buff 跳转链接 | `string` | `BuffUrlItem` | 组件值仍是最终 URL 字符串 |

## 简单列表

字符串列表的标准字段：

```json
{
  "type": "array",
  "title": "文案列表",
  "x-decorator": "FormItem",
  "x-component": "ArrayItemsSimple",
  "x-component-props": {
    "component": "Input.TextArea"
  },
  "default": []
}
```

数字列表的标准字段：

```json
{
  "type": "array",
  "title": "ID 列表",
  "x-decorator": "FormItem",
  "x-component": "ArrayNumbers",
  "x-component-props": {
    "component": "NumberPicker"
  },
  "default": []
}
```

旧 Schema 可能用 `ArrayItemsSimple + NumberPicker` 表示数字列表，运行时可以渲染；新建时优先使用语义明确的 `ArrayNumbers`。

空数组无法推断元素类型。不要仅根据 `[]` 猜测字符串、数字或对象；优先读取同类现有 Schema，否则询问用户。

## 对象列表

对象数组使用下列完整骨架。业务字段放入 `items.properties`，操作节点保持 `type: "void"`。

```json
{
  "type": "array",
  "title": "卡片列表",
  "x-decorator": "FormItem",
  "x-component": "ArrayCollapse",
  "x-component-props": {
    "title": "卡片列表",
    "defaultOpenPanelCount": 0
  },
  "default": [],
  "items": {
    "type": "object",
    "x-component": "ArrayCollapse.CollapsePanel",
    "x-component-props": {
      "header": "卡片"
    },
    "properties": {
      "index": {
        "type": "void",
        "x-component": "ArrayCollapse.Index"
      },
      "title": {
        "type": "string",
        "title": "标题",
        "x-decorator": "FormItem",
        "x-component": "Input"
      },
      "copy": {
        "type": "void",
        "x-component": "ArrayCollapse.Copy"
      },
      "remove": {
        "type": "void",
        "x-component": "ArrayCollapse.Remove"
      },
      "moveDown": {
        "type": "void",
        "x-component": "ArrayCollapse.MoveDown"
      },
      "moveUp": {
        "type": "void",
        "x-component": "ArrayCollapse.MoveUp"
      }
    }
  },
  "properties": {
    "addition": {
      "type": "void",
      "title": "Add",
      "x-component": "ArrayCollapse.Addition"
    }
  }
}
```

分页对象列表将以上所有 `ArrayCollapse` 前缀替换为 `ArrayPagination`。不要传入 `pageSize` 期待改变分页大小；当前项目运行时固定为 10。

`ArrayCards` 和 `ArrayTable` 也已注册，但结构更依赖具体交互。除非用户指定或已有相似 Schema 可复用，否则对象数组优先使用 `ArrayCollapse`；数据量明显较大时使用 `ArrayPagination`。

## 项目组件

上传组件：

```json
{
  "type": "string",
  "title": "封面",
  "x-decorator": "FormItem",
  "x-component": "Upload",
  "x-component-props": {
    "type": "image",
    "accept": ".png,.jpg,.gif"
  }
}
```

```json
{
  "type": "array",
  "title": "图片列表",
  "x-decorator": "FormItem",
  "x-component": "UploadMulti",
  "x-component-props": {
    "type": "image",
    "accept": ".png,.jpg,.gif"
  },
  "default": []
}
```

Buff URL：

```json
{
  "type": "string",
  "title": "跳转链接",
  "x-decorator": "FormItem",
  "x-component": "BuffUrlItem",
  "x-component-props": {
    "placeholder": "请配置跳转链接",
    "disabledValueList": [],
    "showPreview": true
  },
  "default": ""
}
```

`BuffUrlItem.disabledValueList` 的值为数字枚举：`1` 课程、`2` 纯图、`3` 实物、`4` 积木、`5` 其他。

## 允许的组件

运行时注册的主要值组件：

- `Input`、`Input.TextArea`、`Text`、`NumberPicker`、`Switch`、`Password`。
- `Checkbox`、`Checkbox.Group`、`Radio`、`Radio.Group`、`Select`、`Cascader`、`TreeSelect`、`Transfer`。
- `DatePicker`、`DatePicker.RangePicker`、`TimePicker`、`TimePicker.RangePicker`、`Slider`、`Rate`。
- `Upload`、`UploadMulti`、`BuffUrlItem`、`Editable`。
- `ArrayItemsSimple`、`ArrayNumbers`、`ArrayCollapse.*`、`ArrayPagination.*`、`ArrayCards.*`、`ArrayTable.*`。

主要布局组件：`Card`、`Space`、`FormGrid`、`FormGrid.GridColumn`、`FormLayout`、`FormTab`、`FormTab.TabPane`、`FormCollapse`、`FormCollapse.CollapsePanel`。

`PreviewText`、`Reset`、`Submit` 和 `ArrayTabs` 虽然在渲染器注册，但不是自动生成配置编辑表单的默认选择。不要生成未出现在上述列表或现有目标 Schema 中的组件名。

## 生成规则

1. 先根据完整目标配置值推断每个字段的值形状，再选择组件；不要只看字段名。
2. 保持配置 key、Schema `properties` key 和最终值路径一一对应。
3. 每个值字段保留正确的 `type`；组件不能改变配置值的真实类型。
4. 数组必须明确元素类型。对象数组必须生成 `items`，且业务字段位于 `items.properties`。
5. 只为真实业务约束添加 `required`、`enum`、默认值、`x-validator` 和 `x-reactions`，不要凭空增加。
6. 优先复用同类现有 Schema 的组件和 props。无法从配置值或现有 Schema 判断时暂停询问用户。
7. 创建前逐项检查所有 `x-component` 和 `x-decorator` 是否在本协议中注册。
