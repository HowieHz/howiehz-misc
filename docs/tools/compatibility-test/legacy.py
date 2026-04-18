input_number: str = input(
    "输入你要测试的插件总数量（除去你的插件）\n（换一种问法：你的插件要和多少个其他插件做兼容性测试）\n（请输入大于 0 的整数）\n（要展示详细的内部操作请在数字前加上 d，例 d9）："
)
number: int
debug: bool
if input_number.startswith("d"):
    debug = True
    number = int(input_number[1:])
else:
    debug = False
    number = int(input_number)

number_list: list[int] = list(range(1, number + 1))

inside_arrow: str = ""
outside_arrows_set: list[str] = []
defined_elements_set: list[int] = []

set_pair_test_result: dict = (
    {}
)  # 因为有些步骤仅仅是移动元素，比如 inside_arrow 的移动到 defined_elements_set，所以如果有重复的就不需要用户再次输入结果。


def result_input(sets: dict[list[int], bool]) -> bool:
    global set_pair_test_result, inside_arrow, outside_arrows_set, defined_elements_set
    if debug:
        print(
            f"将你的插件和以下序号的插件测试：{lr_sign_to_list(inside_arrow)}, {[lr_sign_to_list(i) for i in outside_arrows_set]}, {defined_elements_set}"
        )
        if str(sets) in set_pair_test_result:
            return set_pair_test_result[str(sets)]
    else:
        if str(sets) in set_pair_test_result:
            return set_pair_test_result[str(sets)]
        print(f"将你的插件和以下序号的插件测试：{sets}")
    result: str = input("是否有兼容性问题，有输入 y 然后回车，无输入 n 然后回车:")
    if result == "y":
        set_pair_test_result[str(sets)] = True
        return True
    set_pair_test_result[str(sets)] = False
    return False


def lr_sign_to_list(lr_sign: str):
    # print(lr_sign)
    temp_number_list = number_list
    if lr_sign == "":
        return number_list
    for sign in lr_sign:
        p = (len(temp_number_list) + 1) // 2
        if sign == "l":
            temp_number_list = temp_number_list[:p]
        elif sign == "r":
            temp_number_list = temp_number_list[p:]
    return temp_number_list


def _next():
    global inside_arrow, outside_arrows_set, defined_elements_set
    sets: list[int] = sorted(
        lr_sign_to_list(inside_arrow)
        + [
            item
            for sublist in [lr_sign_to_list(i) for i in outside_arrows_set]
            for item in sublist
        ]
        + defined_elements_set
    )
    if result_input(sets):
        # 有兼容性问题
        if len(lr_sign_to_list(inside_arrow)) == 1:
            if len(outside_arrows_set) == 0:
                print(
                    f"你的插件和以下序号的插件有兼容性问题：{sorted(lr_sign_to_list(inside_arrow) + defined_elements_set)}"
                )
                return "stop"

            # 将 inside_arrow 内容加入 defined_elements_set
            defined_elements_set.extend(lr_sign_to_list(inside_arrow))
            # 将 outside_arrows_set 最后一项移动到 inside_arrow
            inside_arrow = outside_arrows_set[-1]
            outside_arrows_set.pop()
        else:
            inside_arrow += "l"
        _next()
    else:
        # 无兼容性问题
        if inside_arrow.endswith("l"):
            inside_arrow = inside_arrow[:-1] + "r"
        else:
            outside_arrows_set.append(inside_arrow)
            inside_arrow = inside_arrow[:-1] + "l" + "l"
        _next()


inside_arrow = "l"
_next()
