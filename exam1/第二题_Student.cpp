#include <iostream>
using namespace std;

struct Student {
    char name[50];
    int id;
    float score;
};

// 通过指针接收结构体，必须用 -> 访问成员
void input(Student *stu) {
    cin >> stu->name;
    cin >> stu->id;
    cin >> stu->score;
}

void display(Student *stu) {
    cout << "姓名：" << stu->name << endl;
    cout << "学号：" << stu->id << endl;
    cout << "成绩：" << stu->score << endl;
}

int main() {
    // new 在堆上动态创建，用完必须 delete，避免内存泄漏
    Student *stu = new Student;

    input(stu);
    display(stu);

    delete stu;
    stu = nullptr;
    return 0;
}
