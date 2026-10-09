#include <chrono>
#include <iostream>
#include <string>
#include <thread>

int main()
{
  constexpr auto interval = std::chrono::milliseconds(500);
  const std::string message = "这里是2027导航考核第二题awa";

  while (true) {
    std::cout << message << std::endl;
    std::this_thread::sleep_for(interval);
  }

  return 0;
}
