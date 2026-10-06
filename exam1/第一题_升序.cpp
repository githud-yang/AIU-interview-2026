#include <iostream>
using namespace std;

// 冒泡排序：相邻元素两两比较，大的往后冒
// 外层循环控制轮数，内层循环完成一轮交换
int main() {
    int a[] = {5, 8, 2, 10, 7, 15, 13, 11, 20, 18};
    int n = sizeof(a) / sizeof(a[0]);

    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < n - 1 - i; j++) {
            if (a[j] > a[j + 1]) {
                int temp = a[j];
                a[j] = a[j + 1];
                a[j + 1] = temp;
            }
        }
    }

    cout << "升序输出：";
    for (int i = 0; i < n; i++) {
        cout << a[i];
        if (i != n - 1) {
            cout << " ";
        }
    }
    cout << endl;
    return 0;
}
