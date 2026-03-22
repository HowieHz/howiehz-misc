---
outline: deep
published: 2024-09-02T22:20:00+08:00
author:
  - name: HowieHz
    link: https://github.com/HowieHz
---

<!-- markdownlint-disable MD024 -->

# HRBUST ICPC 练习 2024 级题解分享

::: details 迁移自主站

- 移动原因：单纯放答案，相较于其他认真写的几篇没啥价值。
- Hrbust ACM 练习 2024 级第 1~2 周题单 题解分享
  - 链接：`/archives/hrbustacm-class-of-2024-week-1-2-questionnaire`
  - 分类：`知识传承 > 竞赛解密 > 题解档案`
  - 标签：`简体中文` `2024`
  - 发布时间 2024-09-02T22:20:00+08:00
  - 访问量：289
  - 评论量：0
- Hrbust ACM 练习 2024 级第 3 周题单 题解分享
  - 链接：`/archives/hrbustacm-class-of-2024-week-3-questionnaire`
  - 分类：`知识传承 > 竞赛解密 > 题解档案`
  - 标签：`简体中文` `2024`
  - 发布时间 2024-09-09T22:50:02+08:00
  - 访问量：229
  - 评论量：1
- Hrbust ACM 练习 2024 级第 4 周题单 题解分享 (A-G,J-O)
  - 链接：`/archives/hrbustacm-class-of-2024-week-4-questionnaire`
  - 分类：`知识传承 > 竞赛解密 > 题解档案`
  - 标签：`简体中文` `2024`
  - 发布时间 2024-09-16T20:59:18+08:00
  - 访问量：229
  - 评论量：1
- Hrbust ACM 练习 2024 级第 5 周题单 题解分享 (A-C,F-H)
  - 链接：`/archives/hrbustacm-class-of-2024-week-5-questionnaire`
  - 分类：`知识传承 > 竞赛解密 > 题解档案`
  - 标签：`简体中文` `2024`
  - 发布时间 2024-09-24T00:51:42+08:00
  - 访问量：113
  - 评论量：0
- Hrbust ACM 编程练习 20240922 题解分享
  - 链接：`/archives/hrbustacm-programming-exercise-20240922`
  - 分类：`知识传承 > 竞赛解密 > 题解档案`
  - 标签：`简体中文` `2024`
  - 发布时间 2024-09-24T13:54:35+08:00
  - 访问量：175
  - 评论量：0
- Hrbust ACM 练习 2024 级第 9 周题单 题解分享 (A-B)
  - 链接：`/archives/hrbustacm-class-of-2024-week-9-questionnaire`
  - 分类：`知识传承 > 竞赛解密 > 题解档案`
  - 标签：`简体中文` `2024`
  - 发布时间 2024-11-06T00:51:52+08:00
  - 访问量：89
  - 评论量：0
- Hrbust ACM 练习 2024 级第 11 周题单 题解分享 (A-B)
  - 链接：`/archives/hrbustacm-class-of-2024-week-11-questionnaire`
  - 分类：`知识传承 > 竞赛解密 > 题解档案`
  - 标签：`简体中文` `2024`
  - 发布时间 2024-11-10T02:42:13+08:00
  - 访问量：138
  - 评论量：1

:::

## Hrbust ACM 练习 2024 级第 1~2 周题单 题解分享

### 前言

题单链接：[2024 级第 1~2 周题单 - Virtual Judge (vjudge.net)](https://vjudge.net/contest/652737)
熟悉下 oj 的使用。vjudge 感觉没洛谷好用，提交代码的编辑器没语法高亮。
下面的先是 Python3 代码，之后是 C++ 代码。
注意：主要题目数据范围，有些要开 long long。

### A 题

Python Code

```python
print("Hello World!")
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;

int main(){
    cout << "Hello World!";
    return 0;
}
```

### B 题

Python code

```python
print(chr(int(input())))
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;

int main()
{
    int ch;
    cin >> ch;
    cout << static_cast<char>(ch);
    return 0;
}
```

### C 题

Python code

```python
print(sum(map(int,input().split())))
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;

int main()
{
    int a, b;
    cin >> a >> b;
    cout << a+b;
    return 0;
}
```

### D 题

Python code

```python
print(int(input())**2)
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;

int main()
{
    long long a;
    cin >> a;
    cout << a*a;
    return 0;
}
```

### E 题

Python code

```python
x=int(input())
print(x**2+2*x+5)
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;

int main()
{
    int a;
    cin >> a;
    cout << a*a+a*2+5;
    return 0;
}
```

### F 题

Python code

```python
print(f'{(float(input())-32)/9*5:.5f}')
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;

int main()
{
    double n;
    cin >> n;
    printf("%.5f\n", ((n-32)*5/9));
    return 0;
}
```

### G 题

9 月 5 日编写

Python code

```python
x1, y1 = map(int, input().split())
x2, y2 = map(int, input().split())
print(f"{((x1-x2)**2+(y1-y2)**2)**0.5:.3f}")
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int x1, x2, y1, y2;
    cin >> x1 >> y1 >> x2 >> y2;
    cout << fixed << setprecision(3) << sqrt(pow(x1 - x2, 2) + pow(y1 - y2, 2));
    return 0;
}
```

### H 题

Python code

```python
x = float(input())
if 0 <= x < 5:
    y = -x + 2.5
elif 5 <= x < 10:
    y = 2 - 1.5 * (x - 3) * (x - 3)
elif 10 <= x < 20:
    y = x / 2 - 1.5
print(f"{y:.3f}")
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    double x, y;
    cin >> x;
    if (0 <= x && x < 5)
    {
        y = -x + 2.5;
    }
    else if (5 <= x && x < 10)
    {
        y = 2 - 1.5 * (x - 3) * (x - 3);
    }
    else if (10 <= x && x < 20)
    {
        y = x / 2 - 1.5;
    }
    cout << fixed << setprecision(3) << y;
    return 0;
}
```

### I 题

Python code

```python
n = int(input())
def a():
    for i in range(2, n):
        if n % i == 0:
            print("No")
            return
    print("Yes")
a()
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int n;
    cin >> n;
    for (int i = 2; i <= n - 1; i++)
    {
        if (n % i == 0)
        {
            cout << "No";
            return 0;
        }
    }
    cout << "Yes";
    return 0;
}
```

### J 题

Python code

```python
w = int(input())
if w > 2 and w % 2 == 0:
    print("YES")
else:
    print("NO")
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int w;
    cin >> w;
    if (w > 2 && w % 2 == 0)
    {
        cout << "YES";
    }
    else
    {
        cout << "NO";
    }
    return 0;
}
```

### K 题

Python code

```python
n = int(input())
rt = 0
while n > 0:
    n -= 1
    if sum(map(int, input().split())) >= 2:
        rt += 1
print(rt)
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int lines, ret;
    ret = 0;
    cin >> lines;
    while (lines > 0)
    {
        lines--;
        int x, y, z;
        cin >> x >> y >> z;
        if (x + y + z >= 2)
        {
            ret++;
        }
    }
    cout << ret;
    return 0;
}
```

### L 题

Python code

```python
n = int(input())
while n > 0:
    n -= 1
    word = input()
    if len(word) > 10:
        print(word[0] + str(len(word) - 2) + word[-1])
    else:
        print(word)
```

Cpp code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int n;
    cin >> n;
    while (n > 0)
    {
        n--;
        string s;
        cin >> s;
        if (s.size() > 10)
        {
            cout << s.substr(0, 1) << s.size() - 2 << s.substr(s.size() - 1, s.size()) << endl;
        }
        else
        {
            cout << s << endl;
        }
    }
    return 0;
}
```

## Hrbust ACM 练习 2024 级第 3 周题单 题解分享

### 前言

题单链接：[2024 级第 3 周题单 - Virtual Judge (vjudge.net)](https://vjudge.net/contest/654371)
有些题不能提交 Python 代码，所以只有 Cpp 代码。

我尝试找了找这些题的出处，搜索引擎中搜到的题解大多比笔者写得更好，所以建议直接检索对应题目的题解。

- A 题是 SWUSTOJ 1178
- B 题是 零起点学算法 106
- C 题是 水仙花数，很多 oj 都有，比较常见。但是这个变体没搜到，可能是原创题。
- D 题是 HDU 2016
- E 题是 HDU 2017
- F 题是 HDU 2043
- G 题是 HDU 1062
- H 题是 HDU 2020
- I 题是 51Nod 3212
- J 题是 [计蒜客-T1715](https://vjudge.net/problem/计蒜客-T1715/origin)
- K 题是 [计蒜客-T1232](https://vjudge.net/problem/计蒜客-T1232/origin)

### A 题

Python Code

```python
s = input()
for c in s:
    if "a" <= c <= "y" or "A" <= c <= "Y":
        print(chr(ord(c) + 1), end="")
    elif c == "z":
        print("a", end="")
    elif c == "Z":
        print("A", end="")
    else:
        print(c, end="")
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    string s;
    getline(cin, s);
    for (char c : s)
    {
        if ('a' <= c && c <= 'y')
        {
            cout << char(c + 1);
        }
        else if ('A' <= c && c <= 'Y')
        {
            cout << char(c + 1);
        }
        else if (c == 'z')
        {
            cout << 'a';
        }
        else if (c == 'Z')
        {
            cout << 'A';
        }
        else
        {
            cout << c;
        }
    }
    cout << " ";
    return 0;
}
```

### B 题

Python Code

```python
s = input().split()
rt_s = []
for i in s:
    rt_s.append(i.capitalize())
print(" ".join(rt_s))
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    string word;
    while (cin >> word)
    {
        word[0] = toupper(word[0]);
        cout << word << " ";
    }
}
```

### C 题

这题 水仙花数 很常见，很多 oj 都有类似的

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int a, b, yesorno;
    while (cin >> a >> b)
    {
        yesorno = 0;
        for (int i = a; i <= b; i++)
        {
            if (pow((i / 100), 3) + pow((i / 10 % 10), 3) + pow((i % 10), 3) == i)
            {
                cout << i << " ";
                yesorno = 1;
            }
        }
        if (yesorno == 0)
        {
            cout << "no" << endl;
        } else{
            cout << endl;
        }
    }
}
```

### D 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int n, b;
    while (cin >> n)
    {
        if (n == 0)
        {
            return 0;
        }

        list<int> int_list;
        while (n > 0)
        {
            n--;
            cin >> b;
            int_list.push_back(b);
        }

        list<int> new_int_list = int_list;
        new_int_list.sort();
        int min_number = new_int_list.front();

        list<int>::iterator it = find(int_list.begin(), int_list.end(), min_number);

        int index;
        if (it != int_list.end())
        {
            index = distance(int_list.begin(), it);
        }

        auto it2 = next(int_list.begin(), index);

        *it2 = *int_list.begin();
        *int_list.begin() = min_number;

        while (int_list.size() != 0)
        {
            cout << int_list.front() << " ";
            int_list.pop_front();
        }
        cout << endl;
    }
}
```

### E 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int n;
    cin >> n;
    while (n > 0)
    {
        n--;
        string s;
        int ret = 0;
        cin >> s;
        for (char c : s)
        {
            if (isdigit(c))
            {
                ret++;
            }
        }
        cout << ret;
    }
}
```

### F 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;

bool check(string s)
{
    bool upper = false, lower = false, digit = false, special = false;

    for (char c : s)
    {
        if (isupper(c))
        {
            upper = true;
            continue;
        }
        else if (islower(c))
        {
            lower = true;
            continue;
        }
        else if (isdigit(c))
        {
            digit = true;
            continue;
        }
        else if (c == '~' or c == '!' or c == '@' or c == '#' or c == '$' or c == '%' or c == '^')
        {
            special = true;
            continue;
        }
    }

    if (upper + lower + digit + special >= 3)
    {
        return true;
    }
    else
    {
        return false;
    }
}

int main()
{
    int n;
    cin >> n;
    while (n > 0)
    {
        n--;
        string s;
        cin >> s;
        if (s.size() < 8 or s.size() > 16)
        {
            cout << "NO" << endl;
            continue;
        }

        if (check(s))
        {
            cout << "YES" << endl;
            continue;
        }
        else
        {
            cout << "NO" << endl;
            continue;
        }
    }
    return 0;
}
```

### G 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
int main()
{
    int n;
    cin >> n;
    cin.get();
    while (n > 0)
    {
        n--;
        string str;
        list<char> char_list;
        list<char> char_list_r;
        getline(cin, str);
        for (char c : str)
        {
            if (c == ' ')
            {
                for (auto const &i : char_list_r)
                {
                    cout << i;
                }
                char_list_r.clear();
                cout << ' ';
                continue;
            }
            char_list_r.push_front(c);
        }
        for (auto const &i : char_list_r)
        {
            cout << i;
        }
        char_list_r.clear();
        cout << endl;
    }
}
```

### H 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;

bool cmp(const int a, const int b)
{
    return abs(a) > abs(b);
}

int main()
{
    int n, b;
    while (cin >> n)
    {
        if (n == 0)
        {
            return 0;
        }
        list<int> int_list;
        while (n > 0)
        {
            n--;
            cin >> b;
            int_list.push_back(b);
        }
        int_list.sort(cmp);
        for (auto const &i : int_list)
        {
            cout << i << " ";
        }
        cout << endl;
    }
}
```

### I 题

Python Code

```python
n = int(input())
l = []
while True:
    if n == 0:
        break
    l.append(str(n % 10))
    n //= 10
min_n = sorted(l)
if min_n[0] == "0":
    for index, n in enumerate(min_n):
        if n != "0":
            min_n[0] = min_n[index]
            min_n[index] = "0"
            break
print("".join(sorted(l, reverse=True)), "".join(min_n))
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    long long n;
    cin >> n;
    list<long long> int_list;
    list<long long> int_list_r;
    while (true) {
        if (n == 0) {
            break;
        }
        int_list.push_back(n % 10);
        n /= 10;
    }
    int_list.sort();

    for (long long n : int_list) {
        int_list_r.push_front(n);
    }

    for (auto const &i : int_list_r) {
        cout << i;
    }
    cout << " ";

    while (int_list.front() == 0) {
        auto it = int_list.begin();
        while (*(it++) == 0) {
            continue;
        }
        int_list.emplace(it, 0);
        int_list.pop_front();
    }
    for (auto const &i : int_list) {
        cout << i;
    }
}
```

### J 题

这题奇怪的是`思路一实现一`只需要开 99 大小的数组就能过，而`思路二实现二`需要开 100 大小的数组才能过。

思路一实现一 Cpp Code（关键：用 scanf 写入 char\[\] 无需取址、用 strcpy 写入结构体 char\[\])

```cpp
#include <bits/stdc++.h>
using namespace std;
struct T
{
    char name[21];
    long long order;
} tl[99];

bool cmp(T a, T b)
{
    return a.order < b.order;
}

int main()
{
    int n;
    cin >> n;

    for (int i = 0; i < n; i++)
    {
        char name[21];
        long long y, m, d, input_order;
        scanf("%s %lld %lld %lld", name, &y, &m, &d);

        input_order = n - i;

        strcpy(tl[i].name, name);
        tl[i].order = y * 10000000 + m * 100000 + d * 1000 + input_order;
    }

    sort(tl, tl + n, cmp);

    for (int i = 0; i < n; i++)
    {
        cout << tl[i].name << endl;
    }

    return 0;
}
```

思路一实现二 Cpp Code 另一种实现（关键：结构体用 string、scanf 写入 string 的方法）

```cpp
#include <bits/stdc++.h>
using namespace std;
struct T {
    string name;
    long long order;
} tl[100];

bool cmp(T a, T b) { return a.order < b.order; }

int main() {
    int n;
    cin >> n;

    for (int i = 0; i < n; i++) {
        string name;
        name.resize(21);
        long long y, m, d, input_order;
        scanf("%s %lld %lld %lld", &name[0], &y, &m, &d);

        input_order = n - i;

        // 调用 c_str 方法，清除上面 resize 方法多申请的空间
        name = name.c_str();

        // 另一种方法清除上面 resize 方法多申请的空间，由李晟霄同学提供
        // for (int i = 0; i < name.length(); i++) {
        //     if (int(name[i]) == 0) {
        //         name.resize(i);
        //         break;
        //     }
        // }

        tl[i].name = name;
        tl[i].order = y * 10000000 + m * 100000 + d * 1000 + input_order;
    }

    sort(tl, tl + n, cmp);

    for (int i = 0; i < n; i++) {
        cout << tl[i].name << endl;
    }

    return 0;
}
```

思路二实现一 Cpp Code 另一种实现（关键：cin 直接写入结构体 string）

```cpp
#include <bits/stdc++.h>
using namespace std;
struct T
{
    long long y, m, d, order;
    string name;
} tl[100];

bool cmp(T n1, T n2)
{
    if (n1.y != n2.y)
    {
        return n1.y < n2.y;
    }
    if (n1.m != n2.m)
    {
        return n1.m < n2.m;
    }
    if (n1.d != n2.d)
    {
        return n1.d < n2.d;
    }
    return n1.order > n2.order;
}

int main()
{
    int n;
    cin >> n;
    for (int i = 0; i < n; i++)
    {
        cin >> tl[i].name >> tl[i].y >> tl[i].m >> tl[i].d;
        tl[i].order = i;
    }

    sort(tl, tl + n, cmp);

    for (int i = 0; i < n; i++)
    {
        cout << tl[i].name << endl;
    }

    return 0;
}
```

### K 题

Python Code

```python
t = input()
n = int(input())
l = [input() for _ in range(n)]

if t == "inc":
    l.sort()
elif t == "dec":
    l.sort(reverse=True)
elif t == "ncinc":
    l.sort(key=lambda s: s.lower())
else:
    l.sort(key=lambda s: s.lower(), reverse=True)

for s in l:
    print(s)
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;

string tolower_string(const string &s)
{
    string lower_s = s;
    transform(lower_s.begin(), lower_s.end(), lower_s.begin(), ::tolower);
    return lower_s;
}

bool cicmp(const string &m, const string &n) // case insensitive compare
{
    return tolower_string(m) < tolower_string(n);
}

bool cicmpr(const string &m, const string &n)
{
    return tolower_string(m) > tolower_string(n);
}

int main()
{
    string t;
    int n;

    cin >> t;
    cin >> n;

    vector<string> l(n);
    for (int i = 0; i < n; ++i)
    {
        cin >> l[i];
    }

    if (t == "inc")
    {
        sort(l.begin(), l.end());
        // sort(l.begin(), l.end(), less<string>());
    }
    else if (t == "dec")
    {
        sort(l.begin(), l.end(), greater<string>());
    }
    else if (t == "ncinc")
    {
        sort(l.begin(), l.end(), cicmp);
    }
    else
    {
        sort(l.begin(), l.end(), cicmpr);
    }

    for (const string &s : l)
    {
        cout << s << endl;
    }

    return 0;
}
```

## Hrbust ACM 练习 2024 级第 4 周题单 题解分享 (A-G,J-O)

### 前言

题单链接：[2024 级第 4 周题单 - Virtual Judge (vjudge.net)](https://vjudge.net/contest/655873)

很多同学困惑怎么学习 C++，我在此分享下我的经验。
我也是刚学习 C++ 没几天，按照我之前自己学习 Python 的经验来说，如果有条件买本**翻译水平较好的外国著作**来学习是再好不过的，退一步来说就是从网上的文章或者从下载的电子书中学习 C++。

在我的个人体验中，通过高效精练的文字中学习是比从视频和直播中学习更快的。一本好的书更是能作为参考书来随时查阅。

网站我推荐 [OI Wiki](https://oi.wiki/)，在这个网站你可以学习到竞赛所需的语言知识和算法知识，另外推荐使用[洛谷 OJ](https://www.luogu.com.cn/) 中的官方题单进行能力训练。

祝大家学有所成！

### A 题

直接累加会超时，打表观察后直接计算。

Python Code

```python
from math import ceil

n = int(input())
if n % 2 == 0:
    print(ceil(n / 2))
else:
    print(-ceil(n / 2))
```

Python Code 另一种实现

```python
n = int(input())
s = (n + 1) // 2
if n % 2 == 0:
    print(s)
else:
    print(-s)
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ll n;
    cin >> n;
    ll s = (n + 1) / 2;
    if (n % 2 == 1) {
        cout << -s;
    } else {
        cout << s;
    }
    return 0;
}
```

### B 题

直接用标准库实现即可

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int n;
    cin >> n;
    vector<int> l;

    while (n > 0) {
        n--;
        int a;
        cin >> a;

        if (a == 1) {
            int t;
            cin >> t;
            l.push_back(t);
        } else if (a == 2) {
            sort(l.begin(), l.end());
        } else if (a == 3) {
            reverse(l.begin(), l.end());
        } else if (a == 4) {
            cout << l.size() << endl;
        } else if (a == 5) {
            for (int i : l) {
                cout << i << " ";
            }
            cout << endl;
        } else if (a == 6) {
            l.clear();
        }
    }
    return 0;
}
```

### C 题

直接用标准库实现即可

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int n;
    cin >> n;
    stack<int> l;
    while (n > 0) {
        n--;
        int a;
        cin >> a;

        if (a == 1) {
            int t;
            cin >> t;
            l.push(t);
        } else if (a == 2) {
            cout << l.top() << endl;
        } else if (a == 3) {
            l.pop();
        } else if (a == 4) {
            cout << l.size() << endl;
        }
    }
}
```

### D 题

直接用标准库实现即可

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int n;
    cin >> n;
    stack<int> l;
    while (n > 0) {
        n--;
        int a;
        cin >> a;

        if (a == 1) {
            int t;
            cin >> t;
            l.push(t);
        } else if (a == 2) {
            cout << l.top() << endl;
        } else if (a == 3) {
            l.pop();
        } else if (a == 4) {
            cout << l.size() << endl;
        }
    }
}
```

### E 题

按照要求操作即可

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int T, m, i = 0;
    long long unsigned n;
    cin >> T;

    while (T > 0) {
        T--;
        i++;
        cout << "Case " << i << ":" << endl;
        cin >> n >> m;
        deque<int> l;
        while (m > 0) {
            m--;
            string a;
            cin >> a;

            if (a == "pushLeft") {
                int number;
                cin >> number;
                if (l.size() == n) {
                    cout << "The queue is full" << endl;
                } else {
                    l.push_front(number);
                    cout << "Pushed in left: " << number << endl;
                }
            } else if (a == "pushRight") {
                int number;
                cin >> number;
                if (l.size() == n) {
                    cout << "The queue is full" << endl;
                } else {
                    l.push_back(number);
                    cout << "Pushed in right: " << number << endl;
                }
            } else if (a == "popLeft") {
                if (l.size() == 0) {
                    cout << "The queue is empty" << endl;
                } else {
                    cout << "Popped from left: " << l.front() << endl;
                    l.pop_front();
                }
            } else if (a == "popRight") {
                if (l.size() == 0) {
                    cout << "The queue is empty" << endl;
                } else {
                    cout << "Popped from right: " << l.back() << endl;
                    l.pop_back();
                }
            }
        }
    }
    return 0;
}
```

### F 题

原题链接：[HDU 1022](https://acm.hdu.edu.cn/showproblem.php?pid=1022)

车库是个 stack 命名为 st
火车进入序列（顺序）是 st_in
火车退出序列（顺序）是 st_out

思路很简单，每次循环只要车库有车，就先比较`车库最口上的车和 st_out 下一个要求出去的车`是不是一样的，如果是一样的就出车（st 出车，st_out 删掉要求出车）。
如果`车库没车`或者`车库有车但是车库最口上的车和 st_out 下一个要求出去的车不一样`，就从 st_in 取一辆车。
如果从 st_in 取车的时候发现无车可取（st_in 的 size 为 0），那就退出循环。

退出循环后只有两种可能

1. 车库没车，从 st_in 取车也没车。这个时候退出的循环，其实就是车全部按照序列走光了。那就是成功了。这时候 st_out 的 size 一定是 0，st 的 size 也是 0。
2. 车库有车，但是`车库有车但是车库最口上的车和 st_out 下一个要求出去的车不一样`，从 st_in 取车没车。这个时候退出循环说明车被堵住了，没法按照退出序列把车开出去，那就是失败了。这时候 st_out 的 size 一定不为 0，st 的 size 也不为 0。

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int n_o;
    while (cin >> n_o) {
        deque<int> st_in;
        deque<int> st_out;
        stack<int> st;
        deque<string> operations;
        int n = n_o;

        getchar();  // read space
        while (n > 0) {
            st_in.push_back(getchar());
            n--;
        }

        getchar();  // read space
        n = n_o;
        while (n > 0) {
            st_out.push_back(getchar());
            n--;
        }

        while (true) {
            if (st.size() != 0 && st.top() == st_out.front()) {
                st.pop();
                st_out.pop_front();
                operations.push_back("out");
            } else {
                if (st_in.size() == 0) {
                    break;
                } else {
                    st.push(st_in.front());
                    st_in.pop_front();
                    operations.push_back("in");
                }
            }
        }

        if (st.size() == 0) {
            cout << "Yes." << endl;
            for (string s : operations) {
                cout << s << endl;
            }
        } else {
            cout << "No." << endl;
        }
        cout << "FINISH" << endl;
    }
    return 0;
}
```

### G 题

原题链接：[UVA 673](https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&category=8&page=show_problem&problem=614)

这题要注意：需要检查的字符串可能为空

Python Code

```python
def a(s):
    st = []
    d = {"(": ")", "[": "]"}

    for c in s:
        if c in ")]":
            if st and d[st[-1]] == c:
                st.pop()
            else:
                return "No"
        else:
            st.append(c)

    return "No" if st else "Yes"


[print(a(input().strip())) for _ in range(int(input()))]
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

string a(string s) {
    stack<char> l;
    map<char, char> d = {{'(', ')'}, {'[', ']'}};

    for (char c : s) {
        if (c == ')' || c == ']') {
            if (!l.empty() && d[l.top()] == c) {
                l.pop();
            } else {
                return "No";
            }
        } else {
            l.push(c);
        }
    }
    if (l.empty()) {
        return "Yes";
    } else {
        return "No";
    }
}

int main() {
    int n;
    cin >> n;
    getchar();  // 读取上一行输入数据后输入的回车
    while (n > 0) {
        string s;
        getline(cin, s);  // 用 getline 而不是用 cin 是因为后面的字符串序列可能为空
        cout << a(s) << endl;
        n--;
    }
    return 0;
}
```

### H 题

24.9.22 更新

原题是 The 2024 ICPC Asia East Continent Online Contest (I) 的 F 题

> 此题未通过

这题对于我来说太难，一直超时，跳过

```python
c = int(input())

while c > 0:
    rt = 0
    c -= 1
    n = int(input())
    index_max = n - 1
    l = list(map(int, input().split()))
    for i, e in enumerate(l):
        l_step = 0
        r_step = 0
        l_max_number = e
        r_max_number = e
        for l_number in l[i::-1]:
            if l_number > l_max_number:
                l_max_number = l_number
                l_step += 1
            if l_number < l_max_number:
                break
        for r_number in l[i + 1 :]:
            if r_number > r_max_number:
                r_max_number = r_number
                r_step += 1
            if r_number < r_max_number:
                break
        rt += l_step + r_step
    print(rt)
```

### I 题

原题链接：[Codeforces 2013D](https://codeforces.com/contest/2013/problem/D)

### J 题

24.9.22 凌晨更新题解

原题链接：[HDU 2034](https://acm.hdu.edu.cn/showproblem.php?pid=2034)

没啥难度，题目的 A-B 是 $A\cap \complement_UB$ （$A\cap \overline{B}$）

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int n, m;
    while (cin >> n) {
        cin >> m;
        vector<int> a, b;

        if (n == 0 and m == 0) {
            return 0;
        }

        int _number;
        while (n > 0) {
            n--;
            cin >> _number;
            a.push_back(_number);
        }
        while (m > 0) {
            m--;
            cin >> _number;
            b.push_back(_number);
        }

        sort(a.begin(), a.end());
        sort(b.begin(), b.end());
        bool flag = false;
        for (int number : a) {
            if (!binary_search(b.begin(), b.end(), number)) {
                cout << number << " ";
                flag = true;
            }
        }
        if (flag == false) {
            cout << "NULL";
        }
        cout << endl;
    }

    return 0;
}
```

### K 题

24.9.22 凌晨更新题解

原题链接：[HDU 1004](https://acm.hdu.edu.cn/showproblem.php?pid=1004)

在一个字典内统计出现次数，
最后遍历找出出现次数最多的输出即可

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int n;
    string bn;
    while (cin >> n) {
        if (n == 0) {
            return 0;
        }

        map<string, int> m;

        while (n > 0) {
            n--;
            cin >> bn;
            if (m.find(bn) == m.end()) {
                m[bn] = 1;
            } else {
                m[bn] += 1;
            }
        }

        string answer_name;
        int answer_times = 0;
        for (map<string, int>::iterator it = m.begin(); it != m.end(); it++) {
            if (it->second > answer_times) {
                answer_times = it->second;
                answer_name = it->first;
            }
        }

        cout << answer_name << endl;
    }
    return 0;
}
```

### L 题

24.9.22 凌晨更新题解

原题链接：[Codeforces 1722C](https://codeforces.com/problemset/problem/1722/C)

在一个字典中记录各单词出现次数，
最后再各自统计总分即可

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int n_o;
        cin >> n_o;
        int n0 = n_o, n1 = n_o, n2 = n_o;
        string word0[1000], word1[1000], word2[1000];
        map<string, int> word_times;
        string word;
        while (n0 > 0) {
            n0--;
            cin >> word;
            word0[n0] = word;
            if (word_times.find(word) == word_times.end()) {
                word_times[word] = 1;
            } else {
                word_times[word] += 1;
            }
        }
        while (n1 > 0) {
            n1--;
            cin >> word;
            word1[n1] = word;
            if (word_times.find(word) == word_times.end()) {
                word_times[word] = 1;
            } else {
                word_times[word] += 1;
            }
        }
        while (n2 > 0) {
            n2--;
            cin >> word;
            word2[n2] = word;
            if (word_times.find(word) == word_times.end()) {
                word_times[word] = 1;
            } else {
                word_times[word] += 1;
            }
        }
        int rt0 = 0;
        for (string _word : word0) {
            if (word_times[_word] == 1) {
                rt0 += 3;
            } else if (word_times[_word] == 2) {
                rt0 += 1;
            }
        }

        int rt1 = 0;
        for (string _word : word1) {
            if (word_times[_word] == 1) {
                rt1 += 3;
            } else if (word_times[_word] == 2) {
                rt1 += 1;
            }
        }

        int rt2 = 0;
        for (string _word : word2) {
            if (word_times[_word] == 1) {
                rt2 += 3;
            } else if (word_times[_word] == 2) {
                rt2 += 1;
            }
        }

        printf("%d %d %d\n", rt0, rt1, rt2);
    }

    return 0;
}
```

### M 题

24.9.22 凌晨更新 TL 代码
24.9.23 晚上更新 AC 代码

原题链接：[Codeforces 1790D](https://codeforces.com/problemset/problem/1790/D)

题单的制作者今天（24.9.23）给题目加了个提示，在标题里标注这个题需要用字典（map）数据结构。

经过查询和测试后得知字典（map）数据结构遍历时，键（key）是从小到大的，我重新实现了代码。
代码分为两部分，第一部分是将数据读入字典，第二部分（从 `int rt = 0;` 开始）是数据处理部分。
最后字典存储的键代表这个娃的大小，对应的值表示还有多少个这样的娃没用掉。

数据处理的思路是：

1. 遍历字典（根据键从小到大）
2. 当检测到键对应的值大于 0（这里用 `while` 而不是 `if`，因为可以有多组套娃从同一个数开始），就召唤另一个迭代器（it_son），然后检查后继能否继续组成更长的套娃。
   - 如果后继的键是前面的键 +1 且 键对应的值大于 0，说明可以组成更长的套娃。
3. 如果用了这个娃，就对应值 -1，表示用掉一个。
4. 如果后继不满足组成更长的套娃的要求，那就退出循环并且最后统计结果的变量（rt）+1。

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int n;
        map<int, int> dict;
        cin >> n;

        while (n > 0) {
            n--;
            int _number;
            cin >> _number;
            dict[_number]++;
        }

        int rt = 0;

        for (auto it = dict.begin(); it != dict.end(); it++) {
            while (it->second > 0) {
                auto it_son = it;
                it_son++;
                int last_one = it->first;
                while (it_son->second > 0 && it_son->first - 1 == last_one) {
                    it_son->second--;
                    last_one = it_son->first;
                    it_son++;
                }
                rt++;
                it->second--;
            }
        }

        cout << rt << endl;
    }
    return 0;
}
```

<details><summary>这里折叠是代码是带 debug 的代码，将开头的 `bool debug = 1;` 改为 `bool debug = 0;` 即可 AC</summary>

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;
bool debug = 1;
#define dbg(x)                                                   \
    if (debug)                                                   \
        cerr << BRIGHT_CYAN << #x << COLOR_RESET << " = " << (x) \
             << NORMAL_FAINT << COLOR_RESET << endl;
const string COLOR_RESET = "\033[0m", BRIGHT_CYAN = "\033[1;36m",
             NORMAL_FAINT = "\033[0;2m";

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int n;
        map<int, int> dict;
        cin >> n;

        while (n > 0) {
            n--;
            int _number;
            cin >> _number;
            dict[_number]++;
        }

        int rt = 0;

        for (auto it = dict.begin(); it != dict.end(); it++) {
            dbg(it->first);
            dbg(it->second);
            while (it->second > 0) {
                auto it_son = it;
                it_son++;
                int last_one = it->first;
                while (it_son->second > 0 && it_son->first - 1 == last_one) {
                    dbg(it_son->first);
                    dbg(it_son->second);
                    it_son->second--;
                    last_one = it_son->first;
                    it_son++;
                }
                rt++;
                dbg(rt);
                it->second--;
            }
        }

        cout << rt << endl;
    }
    return 0;
}
```

</details>

<details>
<summary>先前 TL 的题解</summary>

题解 Time limit exceeded on test 27

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int n;
        vector<int> v, st, temp_st;
        cin >> n;

        while (n > 0) {
            n--;
            int _number;
            cin >> _number;
            temp_st.push_back(_number);
        }
        sort(temp_st.begin(), temp_st.end());

        if (temp_st.front() == temp_st.back()) {
            cout << temp_st.size() << endl;
            continue;
        }

        int rt = 0;
        do {
            v = temp_st;
            temp_st.clear();

            for (int _number : v) {
                if (st.size() != 0) {
                    int _back = st.back();
                    if (_back == _number) {
                        temp_st.push_back(_number);
                    } else if (_back + 1 == _number) {
                        st.push_back(_number);
                    } else {
                        rt++;
                        st.clear();
                        st.push_back(_number);
                    }
                } else {
                    st.push_back(_number);
                }
            }

            if (st.size() != 0) {
                rt++;
                st.clear();
            }

        } while (temp_st.size() != 0);

        cout << rt << endl;
    }
    return 0;
}
```

</details>

### N 题

24.9.22 下午更新 TL 代码
24.9.23 下午更新 AC 代码

原题链接：[Codeforces 1800C2](https://codeforces.com/problemset/problem/1800/C2)

虽然我不会实现最大堆，但是经过检索找到了一个 `priority_queue` 容器类，默认实现就是最大堆。我把原本 `vector`+`sort` 函数的模式改成 `priority_queue` 就成功 AC 了。

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int n;
        ll rt = 0;
        cin >> n;
        priority_queue<int> st;
        int _number;
        while (n > 0) {
            n--;
            cin >> _number;
            if (_number != 0) {
                st.push(_number);
            } else if (st.size() != 0) {
                rt += st.top();
                st.pop();
            }
        }
        cout << rt << endl;
    }

    return 0;
}
```

### O 题

最基础的 10 转 2 进制

原题链接：[HDU 2051](https://acm.hdu.edu.cn/showproblem.php?pid=2051)

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;

    while (cin >> n) {
        vector<int> v;
        if (n == 0) {
            v.push_back(0);
        }
        while (n > 0) {
            if (n % 2 == 0) {
                v.push_back(0);
                n /= 2;
            } else {
                v.push_back(1);
                n /= 2;
            }
        }

        while (v.size() != 0) {
            cout << v.back();
            v.pop_back();
        }
        cout << endl;
    }

    return 0;
}
```

网上冲浪的时候找到的另一种 Cpp 题解，巧妙的利用了递归，分享一下

```cpp
#include <bits/stdc++.h>
using namespace std;

void D2B(int d) {
    if (d / 2) D2B(d / 2);
    cout << d % 2;
}

int main() {
    int n;

    while (cin >> n) {
        D2B(n);
        cout << endl;
    }

    return 0;
}
```

## Hrbust ACM 练习 2024 级第 5 周题单 题解分享 (A-C,F-H)

### 前言

题单链接：[2024 级第 5 周题单 - Virtual Judge (vjudge.net)](https://vjudge.net/contest/657265)

### A 题

原题链接：[ABC 339C](https://atcoder.jp/contests/abc339/tasks/abc339_c?lang=en)

Python Code

```python
from itertools import accumulate

input()
min_number = 0
last_number = 0

for n in accumulate(map(int, input().split())):
    if n < min_number:
        min_number = n
    last_number = n

if min_number < 0:
    min_number = -min_number
    print(min_number + last_number)
else:
    print(last_number)
```

### B 题

原题链接：[P3397](https://www.luogu.com.cn/problem/P3397)

Python Code

```python
from itertools import accumulate


n, m = map(int, input().split())
l = []
for _m in range(n):
    l.append([])
    for _ in range(n + 1):
        l[_m].append(0)

while m > 0:
    m -= 1
    x1, y1, x2, y2 = map(int, input().split())
    for x in range(x1 - 1, x2):
        l[x][y1 - 1] += 1
        l[x][y2] -= 1

for sl in l:
    print(*list(accumulate(sl[:-1])))
```

### C 题

原题链接：[P2280 [HNOI2003] 激光炸弹 - 洛谷](https://www.luogu.com.cn/problem/P2280)

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int o[5010][5010];

void add(int x, int y, int v) { o[x][y] += v; }

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, r, x, y, v;
    cin >> n >> r;
    int max_x = r, max_y = r;

    for (int i = 0; i < n; i++) {
        cin >> x >> y >> v;
        x++;    // x 和 y 索引都加一，避免越界
        y++;
        if (x > max_x) {
            max_x = x;
        }
        if (y > max_y) {
            max_y = y;
        }
        add(x, y, v);
    }
    for (int _x = 1; _x <= max_x; _x++) {
        for (int _y = 1; _y <= max_y; _y++) {
            o[_x][_y] =
                o[_x][_y] + o[_x - 1][_y] + o[_x][_y - 1] - o[_x - 1][_y - 1];
        }
    }
    int rt = 0;
    for (int _x = r; _x <= max_x; _x++) {
        for (int _y = r; _y <= max_y; _y++) {
            rt = max(rt, o[_x][_y] - o[_x - r][_y] - o[_x][_y - r] +
                             o[_x - r][_y - r]);
        }
    }
    cout << rt;
    return 0;
}
```

Cpp Code 另一种实现

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int o[5010][5010];

void add(int x, int y, int v) { o[x][y] += v; }

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, r, x, y, v;
    cin >> n >> r;
    int max_x = r, max_y = r;

    for (int i = 0; i < n; i++) {
        cin >> x >> y >> v;
        if (x > max_x) {
            max_x = x;
        }
        if (y > max_y) {
            max_y = y;
        }
        add(x, y, v);
    }

    // 计算 y=0 这一列上的前缀和
    for (int i = 1; i <= max_x; i++) {
        o[i][0] += o[i - 1][0];
    }
    // 计算 x=0 这一行上的前缀和
    for (int j = 1; j <= max_y; j++) {
        o[0][j] += o[0][j - 1];
    }
    // 从 (1,1) 开始计算前缀和
    for (int _x = 1; _x <= max_x; _x++) {
        for (int _y = 1; _y <= max_y; _y++) {
            o[_x][_y] =
                o[_x][_y] + o[_x - 1][_y] + o[_x][_y - 1] - o[_x - 1][_y - 1];
        }
    }

    int rt = 0;
    // 从 索引 (r-1，r-1) 开始计算矩阵内数字和（索引 0 到 r-1 长度为 r）
    for (int _x = r - 1; _x <= max_x; _x++) {
        for (int _y = r - 1; _y <= max_y; _y++) {
            int v1, v2, v3, v4;
            v1 = o[_x][_y];

            // 越界判定，防止索引小于 0
            if (_x - r < 0) {
                // 说明：负索引前缀和都是 0
                // 举个例子原数组 1,0,2,3
                // 对应前缀和 1,1,3,6
                // 现在问索引 -1 的前缀和
                // 那原数组其实就变成了 0,1,0,2,3
                // 对应前缀和 0,1,1,3,6（对应索引 -1,0,1,2,3）
                v2 = 0;
            } else {
                v2 = o[_x - r][_y];
            }

            if (_y - r < 0) {
                v3 = 0;
            } else {
                v3 = o[_x][_y - r];
            }

            if (_y - r < 0 or _x - r < 0) {
                v4 = 0;
            } else {
                v4 = o[_x - r][_y - r];
            }

            rt = max(rt, v1 - v2 - v3 + v4);
        }
    }
    cout << rt;
    return 0;
}
```

### D 题

Python Code

```python

```

### E 题

Python Code

```python

```

### F 题

原题链接：[CF670C](https://codeforces.com/problemset/problem/670/C)

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

const long long N = 200000 + 10;
ll scientist_language[N], moive_voice[N], moive_subtitle[N];

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    ll n;
    cin >> n;                        // n = 科学家的数量
    map<ll, ll> scientist_language;  // language_index -> scientist_number
    for (ll i = 1; i <= n; i++) {
        ll language_index;
        cin >> language_index;
        scientist_language[language_index] += 1;
    }
    ll m;
    cin >> m;  // m = 电影院里的电影数量
    for (ll i = 1; i <= m; i++) {
        ll vocie_language;
        cin >> vocie_language;
        moive_voice[i] = vocie_language;  // index 用 1 到 m
    }
    for (ll i = 1; i <= m; i++) {
        ll subtitle_language;
        cin >> subtitle_language;
        moive_subtitle[i] = subtitle_language;  // index 用 1 到 m
    }

    ll very_satisfied = 0;
    ll almost_satisfied = 0;
    ll movie_index = 1;  //  默认值为 1
    for (ll i = 1; i <= m; i++) {
        ll temp_almost_satisfied = scientist_language[moive_subtitle[i]];
        ll temp_very_satisfied = scientist_language[moive_voice[i]];
        if (temp_very_satisfied > very_satisfied) {
            movie_index = i;
            very_satisfied = temp_very_satisfied;
            // almost_satisfied 也要记得更新，否则会错
            almost_satisfied = temp_almost_satisfied;
        } else if (temp_very_satisfied == very_satisfied &&
                   temp_almost_satisfied > almost_satisfied) {
            movie_index = i;
            almost_satisfied = temp_almost_satisfied;
        }
    }

    cout << movie_index << endl;
    return 0;
}
```

Cpp Code 另一种实现

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

const long long N = 200000 + 10;
ll scientist_language[N], moive_voice[N], moive_subtitle[N];

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    ll n;
    cin >> n;                        // n = 科学家的数量
    map<ll, ll> scientist_language;  // language_index -> scientist_number
    for (ll i = 1; i <= n; i++) {
        ll language_index;
        cin >> language_index;
        scientist_language[language_index] += 1;
    }
    ll m;
    cin >> m;  // m = 电影院里的电影数量
    for (ll i = 1; i <= m; i++) {
        ll vocie_language;
        cin >> vocie_language;
        moive_voice[i] = vocie_language;  // index 用 1 到 m
    }
    for (ll i = 1; i <= m; i++) {
        ll subtitle_language;
        cin >> subtitle_language;
        moive_subtitle[i] = subtitle_language;  // index 用 1 到 m
    }

    ll very_satisfied = 0;
    ll movie_index = 1;  //  默认值为 1
    for (ll i = 1; i <= m; i++) {
        ll temp = scientist_language[moive_voice[i]];
        if (temp > very_satisfied) {
            very_satisfied = temp;
            movie_index = i;  // 记录电影编号
        }
    }
    ll almost_satisfied = 0;
    for (ll i = 1; i <= m; i++) {
        ll temp_voice = scientist_language[moive_voice[i]];
        ll temp_subtitle = scientist_language[moive_subtitle[i]];
        if (very_satisfied == temp_voice && almost_satisfied < temp_subtitle) {
            almost_satisfied = temp_subtitle;
            movie_index = i;
        }
    }

    cout << movie_index << endl;
    return 0;
}
```

### G 题

原题链接：[ABC 014C](https://atcoder.jp/contests/abc014/tasks/abc014_3)

Python Code

```python
from itertools import accumulate

n = int(input())
l = [0] * (1000000 + 2)
while n > 0:
    n -= 1
    a, b = map(int, input().split())
    l[a] += 1
    l[b + 1] -= 1
print(max(accumulate(l)))
```

### H 题

原题链接：[ABC 035C](https://atcoder.jp/contests/abc035/tasks/abc035_c)

试了一下 [AtCoder](https://atcoder.jp/)，这个判题机是很奇葩的。之前用 `print(rt, end="")` 会 WA。看了别人的博客才知道这个网站的老题有 bug，在程序输出结束后不进行换行是会 WA 的。新题目已修复。

```python
from itertools import accumulate


n, q = map(int, input().split())
l = []
for _ in range(0, n + 2):
    l.append(1)

while q > 0:
    q -= 1
    li, ri = map(int, input().split())
    l[li - 1] *= -1
    l[ri] *= -1
_n = 0
last_one = 0
rt = ""
for i in range(0, n):
    if _n == n:
        break
    if l[i] == -1:  # 和前一个不一样
        if i == 0 or last_one == 0:
            last_one = 1
        else:
            last_one = 0
        rt += str(last_one)
    else:  # 和前一个一样
        rt += str(last_one)
    _n += 1
print(rt)
```

## Hrbust ACM 编程练习 20240922 题解分享

### 前言

题单链接：[编程练习 20240922 @ Hrbust Online Judge](http://acm.hrbust.edu.cn/contests/index.php?act=login&cid=2365)

### A 题

`d` 的数据类型要用 `double` 而不是 `float` ，否则最后计算的答案会有精度损失。

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int p, w, s;
        double d = 0;
        cin >> p >> w >> s;
        if (s < 250) {
            d = 0;
        } else if (s < 500) {
            d = 0.02;
        } else if (s < 1000) {
            d = 0.05;
        } else if (s < 2000) {
            d = 0.08;
        } else if (s < 3000) {
            d = 0.1;
        } else {
            d = 0.15;
        }
        cout << fixed << setprecision(3) << 1.0 * p * w * s * (1 - d);
        cout << endl;
    }
    return 0;
}
```

### B 题

打表代码

Python Code

```python
l = []
for i in range(-9, 9 + 1):
    temp_l = []
    for _ in range(1, 9 + 1):
        temp_l.append(0)
    l.append(temp_l)

for a in range(-9, 9 + 1):
    for n in range(1, 9 + 1):
        sum = 0
        for le in range(1, n + 1):
            sum += int(le * "1") * a
        l[a + 9][n - 1] = sum
print(l)
```

以上代码输出

<!-- markdownlint-disable MD013 -->

```log
[[-9, -108, -1107, -11106, -111105, -1111104, -11111103, -111111102, -1111111101], [-8, -96, -984, -9872, -98760, -987648, -9876536, -98765424, -987654312], [-7, -84, -861, -8638, -86415, -864192, -8641969, -86419746, -864197523], [-6, -72, -738, -7404, -74070, -740736, -7407402, -74074068, -740740734], [-5, -60, -615, -6170, -61725, -617280, -6172835, -61728390, -617283945], [-4, -48, -492, -4936, -49380, -493824, -4938268, -49382712, -493827156], [-3, -36, -369, -3702, -37035, -370368, -3703701, -37037034, -370370367], [-2, -24, -246, -2468, -24690, -246912, -2469134, -24691356, -246913578], [-1, -12, -123, -1234, -12345, -123456, -1234567, -12345678, -123456789], [0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 12, 123, 1234, 12345, 123456, 1234567, 12345678, 123456789], [2, 24, 246, 2468, 24690, 246912, 2469134, 24691356, 246913578], [3, 36, 369, 3702, 37035, 370368, 3703701, 37037034, 370370367], [4, 48, 492, 4936, 49380, 493824, 4938268, 49382712, 493827156], [5, 60, 615, 6170, 61725, 617280, 6172835, 61728390, 617283945], [6, 72, 738, 7404, 74070, 740736, 7407402, 74074068, 740740734], [7, 84, 861, 8638, 86415, 864192, 8641969, 86419746, 864197523], [8, 96, 984, 9872, 98760, 987648, 9876536, 98765424, 987654312], [9, 108, 1107, 11106, 111105, 1111104, 11111103, 111111102, 1111111101]]
```

<!-- markdownlint-enable MD013 -->

用任意文本编辑器将`[`替换为`{`，`]`替换为`}`即可直接使用

AC 代码

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int ans[][9] = {
    {-9, -108, -1107, -11106, -111105, -1111104, -11111103, -111111102,
     -1111111101},
    {-8, -96, -984, -9872, -98760, -987648, -9876536, -98765424, -987654312},
    {-7, -84, -861, -8638, -86415, -864192, -8641969, -86419746, -864197523},
    {-6, -72, -738, -7404, -74070, -740736, -7407402, -74074068, -740740734},
    {-5, -60, -615, -6170, -61725, -617280, -6172835, -61728390, -617283945},
    {-4, -48, -492, -4936, -49380, -493824, -4938268, -49382712, -493827156},
    {-3, -36, -369, -3702, -37035, -370368, -3703701, -37037034, -370370367},
    {-2, -24, -246, -2468, -24690, -246912, -2469134, -24691356, -246913578},
    {-1, -12, -123, -1234, -12345, -123456, -1234567, -12345678, -123456789},
    {0, 0, 0, 0, 0, 0, 0, 0, 0},
    {1, 12, 123, 1234, 12345, 123456, 1234567, 12345678, 123456789},
    {2, 24, 246, 2468, 24690, 246912, 2469134, 24691356, 246913578},
    {3, 36, 369, 3702, 37035, 370368, 3703701, 37037034, 370370367},
    {4, 48, 492, 4936, 49380, 493824, 4938268, 49382712, 493827156},
    {5, 60, 615, 6170, 61725, 617280, 6172835, 61728390, 617283945},
    {6, 72, 738, 7404, 74070, 740736, 7407402, 74074068, 740740734},
    {7, 84, 861, 8638, 86415, 864192, 8641969, 86419746, 864197523},
    {8, 96, 984, 9872, 98760, 987648, 9876536, 98765424, 987654312},
    {9, 108, 1107, 11106, 111105, 1111104, 11111103, 111111102, 1111111101}};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int a, n;
        cin >> a >> n;
        cout << ans[a + 9][n - 1];
        cout << endl;
    }
    return 0;
}
```

### C 题

打表代码

Python Code

```python
for i in range(1000):
    if (i**2) <= 1000000:
        if str(i**2).endswith(str(i)):
            print(i**2, end=",")
```

以上代码输出

```log
0,1,25,36,625,5776,141376,390625,
```

AC 代码

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int ans[] = {0, 1, 25, 36, 625, 5776, 141376, 390625};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int a, b;
        cin >> a >> b;
        bool flag = true;
        for (int number : ans) {
            if (number <= b && number >= a) {
                // 避免输出多余空格的设计
                if (flag) {
                    cout << number;
                    flag = false;
                } else {
                    cout << " " << number;
                }
            }
        }
        cout << endl;
    }
    return 0;
}
```

### D 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    cin >> n;
    while (n > 0) {
        n--;
        int a, b;
        cin >> a >> b;
        vector<int> l;
        bool start_flag = true;
        for (int i = a; i <= b; i++) {
            if (i % 3 != 0) {
                if (start_flag) {
                    cout << i;
                    start_flag = false;
                    continue;
                }
                cout << " " << i;
            }
        }
        cout << endl;
    }

    return 0;
}
```

### E 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int a;
        cin >> a;
        int max_line = 2 * a - 1;
        for (int i = 1; i <= max_line; i += 2) {
            for (int ii = 0; ii <= ((max_line - i) / 2) - 1; ii++) {
                cout << " ";
            }
            for (int iii = 0; iii <= i - 1; iii++) {
                cout << "*";
            }

            cout << endl;
        }
        for (int i = max_line; i > 1; i -= 2) {
            for (int ii = (max_line - i) / 2 + 1; ii > 0; ii--) {
                cout << " ";
            }
            for (int iii = (i - 1) - 1; iii > 0; iii--) {
                cout << "*";
            }

            cout << endl;
        }
    }
    return 0;
}
```

### F 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int a;
        cin >> a;
        int max_line = 2 * a + 1;
        for (int i = 1; i <= max_line; i += 2) {
            int c = (i + 1) / 2;
            for (int ii = 0; ii <= ((max_line - i) / 2) - 1; ii++) {
                cout << " ";
            }
            bool flag = false;
            for (int iii = 0; iii <= i - 1; iii++) {
                cout << c;
                if (c > 1) {
                    if (flag) {
                        c++;
                    } else {
                        c--;
                    }
                } else if (c == 1) {
                    c++;
                    flag = true;
                }
            }

            cout << endl;
        }
        for (int i = max_line; i > 1; i -= 2) {
            int c = (i - 2 + 1) / 2;
            for (int ii = (max_line - i) / 2 + 1; ii > 0; ii--) {
                cout << " ";
            }
            bool flag = false;
            for (int iii = i - 2; iii > 0; iii--) {
                cout << c;
                if (c > 1) {
                    if (flag) {
                        c++;
                    } else {
                        c--;
                    }
                } else if (c == 1) {
                    c++;
                    flag = true;
                }
            }

            cout << endl;
        }
    }
    return 0;
}
```

### G 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int o_a, o_b, max_number = 0, ans_x = 0, ans_y = 0, a = 0;
        cin >> o_a >> o_b;
        while (a < o_a) {
            a++;
            int b = 0;
            while (b < o_b) {
                b++;
                int temp;
                cin >> temp;
                if (temp > max_number) {
                    max_number = temp;
                    ans_x = a;
                    ans_y = b;
                }
            }
        }
        cout << ans_x << " " << ans_y << endl;
    }
    return 0;
}
```

### H 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t, n, x;
    cin >> t;
    while (t > 0) {
        cin >> n >> x;
        t--;
        bool flag = true, flag2 = true;
        while (n > 0) {
            n--;
            int temp;
            cin >> temp;
            if (temp >= x && flag2) {
                if (flag) {
                    cout << x << " " << temp;
                    flag = false;
                } else {
                    cout << " " << x << " " << temp;
                }
                flag2 = false;
            } else {
                if (flag) {
                    cout << temp;
                    flag = false;
                } else {
                    cout << " " << temp;
                }
            }
        }
        if (flag2) {
            cout << " " << x;
        }
        cout << endl;
    }
    return 0;
}
```

### I 题

Cpp Code

```cpp
#include <bits/stdc++.h>
typedef long long ll;
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    cin.ignore();
    while (t > 0) {
        t--;
        string s;
        int letter = 0, digit = 0, space = 0, others = 0;

        getline(cin, s);
        for (char c : s) {
            if (isupper(c) or islower(c)) {
                letter++;
            } else if (isdigit(c)) {
                digit++;
            } else if (isspace(c)) {
                space++;
            } else {
                others++;
            }
        }

        printf("%d %d %d %d\n", letter, space, digit, others);
    }
    return 0;
}
```

### J 题

Cpp Code

```cpp
#include <bits/stdc++.h>
typedef long long ll;
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    cin.ignore();
    while (t > 0) {
        t--;
        string s;
        int word = 0;
        bool last_one = false;

        getline(cin, s);
        bool flag = false;
        for (char c : s) {
            if (isspace(c)) {
                last_one = flag;
                flag = false;
            } else {  //  非空
                last_one = flag;
                flag = true;
            }
            if (flag && last_one == false) {
                word++;
            }
        }

        printf("%d\n", word);
    }
    return 0;
}
```

### K 题

Cpp Code

```cpp
#include <bits/stdc++.h>
typedef long long ll;
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    cin.ignore();
    while (t > 0) {
        t--;
        string s;
        int line = 3;
        int upper = 0, lower = 0, digit = 0, space = 0, others = 0;

        while (line > 0) {
            line--;
            getline(cin, s);
            for (char c : s) {
                if (isupper(c)) {
                    upper++;
                } else if (islower(c)) {
                    lower++;
                } else if (isdigit(c)) {
                    digit++;
                } else if (isspace(c)) {
                    space++;
                } else {
                    others++;
                }
            }
        }
        printf("%d %d %d %d %d\n", upper, lower, digit, space, others);
    }
    return 0;
}
```

### L 题

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int n;
        cin >> n;
        int ret = 0;
        while (n >= 5) {
            n /= 5;
            ret += n;
        }
        cout << ret << endl;
    }
    return 0;
}
```

### M 题

[约瑟夫问题 - OI Wiki (oi-wiki.org)](https://oi-wiki.org/misc/josephus/)

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int josephus(int n, int k) {
    int res = 0;
    for (int i = 2; i <= n; ++i) {
        res = (res + k) % i;
    }
    return res;
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int M, K;
        cin >> M >> K;
        // 约瑟夫环公式使用示例
        int i;
        for (i = 1; i <= M; i++) {
            if (josephus(M, i) + 1 == K) {
                cout << i << "\n";
                break;
            };
        }
        if (i > M) {
            cout << "No Solution!\n";
        }
    }

    return 0;
}
```

### N 题

一开始 AC 的代码，因为之前的代码 TL 了
Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

vector<int> prime = {
    2,   3,   5,   7,   11,  13,  17,  19,  23,  29,  31,  37,  41,  43,
    47,  53,  59,  61,  67,  71,  73,  79,  83,  89,  97,  101, 103, 107,
    109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167, 173, 179, 181,
    191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263,
    269, 271, 277, 281, 283, 293, 307, 311, 313, 317, 331, 337, 347, 349,
    353, 359, 367, 373, 379, 383, 389, 397, 401, 409, 419, 421, 431, 433,
    439, 443, 449, 457, 461, 463, 467, 479, 487, 491, 499, 503, 509, 521,
    523, 541, 547, 557, 563, 569, 571, 577, 587, 593, 599, 601, 607, 613,
    617, 619, 631, 641, 643, 647, 653, 659, 661, 673, 677, 683, 691, 701,
    709, 719, 727, 733, 739, 743, 751, 757, 761, 769, 773, 787, 797, 809,
    811, 821, 823, 827, 829, 839, 853, 857, 859, 863, 877, 881, 883, 887,
    907, 911, 919, 929, 937, 941, 947, 953, 967, 971, 977, 983, 991, 997};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        ll n;
        cin >> n;
        cout << n << "=";
        bool flag = true;
        for (int p_number : prime) {
            while (n % p_number == 0) {
                n /= p_number;
                if (flag) {
                    cout << p_number;
                    flag = false;
                } else {
                    cout << "*" << p_number;
                }
            }
        }
        int divisor = 1021;
        while (n > 1) {
            while (n % divisor == 0) {
                if (flag) {
                    cout << divisor;
                    flag = false;
                } else {
                    cout << "*" << divisor;
                }
                n /= divisor;
                prime.push_back(divisor);
                divisor = prime.back();
            }
            divisor++;
        }
        cout << endl;
    }

    return 0;
}
```

事实是我想多了，这样也能 AC。之前 TL 的代码找不到了，也要成未解之谜了。
Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int t;
    cin >> t;
    while (t > 0) {
        t--;
        int n;
        cin >> n;
        cout << n << "=";
        bool flag = true;
        int divisor = 2;
        while (n > 1) {
            while (n % divisor == 0) {
                if (flag) {
                    cout << divisor;
                    flag = false;
                } else {
                    cout << "*" << divisor;
                }
                n /= divisor;
                divisor = 2;
            }
            divisor++;
        }
        cout << endl;
    }
    return 0;
}
```

## Hrbust ACM 练习 2024 级第 9 周题单 题解分享 (A-B)

### 前言

题单链接：[2024 级第九周题单 (DFS && BFS) - Virtual Judge (vjudge.net)](https://vjudge.net/contest/666642)

### A 题

原题链接：[B3622 枚举子集（递归实现指数型枚举） - 洛谷](https://www.luogu.com.cn/problem/B3622)

Python Code

```python
arr = [0] * 11

def dfs(site):
    if site == n+1:
        print("".join(arr[1:site]))
    if site <= n:
        for j in ["N","Y"]:
            arr[site] = j
            dfs(site+1)

n = int(input())
dfs(1)
```

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
typedef long long ll;

int m;
char arr[11],s[2]={'N','Y'};

void dfs(int cur) {
    if (cur == m+1) {
        for (int j = 1; j <= cur - 1; ++j) printf("%c", arr[j]);
        printf("\n");
    }
    if (cur <= m) {
        for (int j = 0; j <= 1; ++j) {
            arr[cur] = s[j];
            dfs(cur + 1);
        }
    }
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    scanf("%d", &m);
    dfs(1);
    return 0;
}
```

### B 题

原题链接：[P1706 全排列问题 - 洛谷](https://www.luogu.com.cn/problem/P1706)、[T1735 全排列问题 - 计蒜客](https://www.jisuanke.com/problem/T1735)

Cpp Code

```cpp
#include <bits/stdc++.h>
using namespace std;
#define endl '\n'
#define ios ios::sync_with_stdio(false), cin.tie(nullptr)

const int N = 10;  // 1 based
int n;
int a[N];    // 记录已经使用的数字构成的序列
bool st[N];  // 记录数字是否使用

void dfs(int cur) {
    if (cur == n + 1) {
        for (int i = 1; i <= n; ++i) {
            cout << std::setw(5) << a[i];
        }
        cout << endl;
        return;
    }
    for (int i = 1; i <= n; ++i) {
        if (st[i]) {
            continue;
        }
        a[cur] = i;
        st[i] = true;
        dfs(cur + 1);
        a[cur] = 0;
        st[i] = false;
    }
}
void solve() {
    cin >> n;
    dfs(1);
}

int main() {
    ios;
    int T = 1;
    while (T--) {
        solve();
    }
}
```

Python Code 洛谷能过，计蒜客上最后一个点会超时，可能是 Python 递归效率低导致的

```python
N = 10
a = [0] * N
st = [False] * N


def dfs(cur):
    if cur == n + 1:
        print("".join(f"{x:5}" for x in a[1 : n + 1]))

    for i in range(1, n + 1):
        if st[i]:
            continue
        a[cur] = i
        st[i] = True
        dfs(cur + 1)
        a[cur] = 0
        st[i] = False


n = int(input())
dfs(1)
```

## Hrbust ACM 练习 2024 级第 11 周题单 题解分享 (A-B)

### 前言

题单链接：[2024 第 11 周题单 图论基础 - Virtual Judge](https://vjudge.net/contest/670756)

### A 题

原题链接：[P5318【深基 18.例 3】查找文献 - 洛谷](https://www.luogu.com.cn/problem/P5318)

Cpp Code

```cpp
#include <bits/stdc++.h>

using namespace std;

int n, m;
vector<bool> vis;
vector<int> max_node;
vector<vector<int>> adj;

void dfs(int u) {
    if (vis[u]) {
        return;
    }

    vis[u] = true;
    cout << u << " ";
    for (int i = 0; i < (int)adj[u].size(); ++i) {
        dfs(adj[u][i]);
    }
    return;
}

// 另一种 dfs 实现
// void dfs(int u) {
//     vis[u] = true;
//     cout << u << " ";
//     for (int i = 0; i < (int)adj[u].size(); ++i) {
//         int next_node = adj[u][i];
//         if (!vis[next_node]) {
//             dfs(next_node);
//         }
//     }
//     return;
// }

void bfs(int u) {
    queue<int> q;

    q.push(u);
    vis[u] = true;
    cout << u << " ";

    while (!q.empty()) {
        u = q.front();
        q.pop();
        for (int i = 0; i < (int)adj[u].size(); ++i) {
            if (!vis[adj[u][i]]) {
                q.push(adj[u][i]);
                vis[adj[u][i]] = true;
                cout << adj[u][i] << " ";
            }
        }
    }
}

int main() {
    cin >> n >> m;

    adj.resize(n + 1);

    for (int i = 1; i <= m; ++i) {
        int u, v;
        cin >> u >> v;
        adj[u].push_back(v);
    }

    for (int i = 1; i <= n; i++) {
        sort(adj[i].begin(), adj[i].end());
    }

    vis.assign(n + 1, false);
    for (int i = 1; i <= 2; i++) {
        dfs(i);
    }

    cout << '\n';

    vis.assign(n + 1, false);
    bfs(1);

    return 0;
}
```

### B 题

原题链接：[P3916 图的遍历 - 洛谷](https://www.luogu.com.cn/problem/P3916)

Cpp Code

```cpp
#include <bits/stdc++.h>

using namespace std;

int n, m;
vector<bool> vis;
vector<int> max_node;
vector<vector<int>> adj;

void dfs(int u, int start_node) {
    if (vis[u]) {  // 要是访问过，一定是被比较大的 start_node 访问的
        return;
    }
    vis[u] = true;
    max_node[u] = start_node;
    for (int i = 0; i < (int)adj[u].size(); ++i) {
        dfs(adj[u][i], start_node);
    }
    return;
}

int main() {
    cin >> n >> m;

    vis.assign(n + 1, false);
    adj.resize(n + 1);
    max_node.resize(n + 1);

    for (int i = 1; i <= m; ++i) {
        int u, v;
        cin >> u >> v;
        adj[v].push_back(u);
    }

    for (int i = n; i >= 1; i--) {
        dfs(i, i);
    }
    for (int i = 1; i <= n; ++i) {
        cout << max_node[i] << " ";
    }

    return 0;
}
```
