#include <iostream>
#include <string>
using namespace std;

class Car {
private:
    string color;
    int number;

public:
    // 构造函数：创建对象时自动调用，用来初始化
    Car(string c, int n) {
        color = c;
        number = n;
        cout << "构造函数被调用，车辆已创建" << endl;
    }

    // 析构函数：对象生命周期结束时自动调用
    ~Car() {
        cout << "析构函数被调用，车辆已销毁" << endl;
    }

    // 题目原文写成“输出学生信息”，这里按题意输出车辆信息
    void display() {
        cout << "颜色：" << color << endl;
        cout << "车牌号：" << number << endl;
    }
};

int main() {
    Car car1("红色", 12345);
    Car car2("蓝色", 67890);

    cout << "----- 第一辆车 -----" << endl;
    car1.display();
    cout << "----- 第二辆车 -----" << endl;
    car2.display();

    return 0;
}
